import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiClientService } from './ai-client.service';
import { PromptTemplates } from './prompt-templates';
import {
  validateCampaignBuilderOutput,
  validateRiskSummaryOutput,
  validateRiskUserOutput,
  validateMobileCoachOutput,
  parseJsonFromResponse,
  CampaignBuilderOutput,
} from './ai-guardrails';
import { aiConfig } from './ai.config';

const AI_AUDIT_TYPES = {
  CAMPAIGN_BUILDER: 'CAMPAIGN_BUILDER',
  RISK_SUMMARY: 'RISK_SUMMARY',
  MOBILE_COACH: 'MOBILE_COACH',
} as const;

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiClientService,
  ) {}

  private async audit(type: string, userId?: number, brandId?: number, inputJson?: object, outputJson?: object) {
    try {
      await this.prisma.aiAuditLog.create({
        data: { type, userId: userId ?? null, brandId: brandId ?? null, inputJson: inputJson ?? undefined, outputJson: outputJson ?? undefined },
      });
    } catch (e) {
      console.warn('[AI] Audit log failed', e);
    }
  }

  /** Campaign builder: suggest campaign structure from objective + budget. */
  async campaignBuilder(
    params: {
      objective: string;
      budgetCents: number;
      durationDays: number;
      platforms: string[];
      city?: string;
      campaignSize?: 'LITE' | 'STANDARD' | 'BOOST';
    },
    brandId: number,
    userId?: number,
  ): Promise<CampaignBuilderOutput> {
    const budgetCents = Math.max(0, Math.floor(Number(params.budgetCents)));
    const input = {
      objective: String(params.objective || '').slice(0, 500),
      budgetCents,
      durationDays: Math.max(1, Math.min(365, Math.floor(Number(params.durationDays || 7)))),
      platforms: Array.isArray(params.platforms) ? params.platforms.slice(0, 5) : [],
      city: params.city ? String(params.city).slice(0, 100) : undefined,
      campaignSize: params.campaignSize ?? 'STANDARD',
    };

    if (!aiConfig().enabled) {
      const fallback = this.getFallbackCampaignBuilder(
        input.budgetCents,
        input.durationDays,
        input.campaignSize,
      );
      await this.audit(AI_AUDIT_TYPES.CAMPAIGN_BUILDER, userId, brandId, input, fallback);
      return fallback;
    }

    const userContent = JSON.stringify(input);
    const raw = await this.aiClient.complete(PromptTemplates.CAMPAIGN_BUILDER, userContent);
    let output: CampaignBuilderOutput;
    if (raw) {
      const parsed = parseJsonFromResponse(raw);
      output = validateCampaignBuilderOutput(parsed, budgetCents);
    } else {
      output = this.getFallbackCampaignBuilder(budgetCents, input.durationDays, input.campaignSize);
    }
    await this.audit(AI_AUDIT_TYPES.CAMPAIGN_BUILDER, userId, brandId, input, output);
    return output;
  }

  /**
   * Deterministic campaign sizing for pilot. Target: Mixed preset FOLLOW 100, LIKE 150, COMMENT 50.
   * LITE / STANDARD / BOOST scale. Min 5 per type. Scale down proportionally if budget insufficient.
   */
  private getFallbackCampaignBuilder(
    budgetCents: number,
    durationDays: number,
    campaignSize: 'LITE' | 'STANDARD' | 'BOOST' = 'STANDARD',
  ): CampaignBuilderOutput {
    const sizeFactor = campaignSize === 'LITE' ? 0.5 : campaignSize === 'BOOST' ? 1.5 : 1;
    const durationFactor =
      durationDays <= 3 ? 0.6 : durationDays <= 7 ? 1 : durationDays <= 14 ? 1.8 : Math.min(2.5, 1 + (durationDays - 14) / 30);
    const scale = sizeFactor * durationFactor;

    const roundQty = (n: number) => Math.max(5, Math.round(n / 5) * 5);
    const mins: Record<string, number> = { LIKE: 5, FOLLOW: 5, COMMENT: 5, STORY: 5, POST: 5 };
    const baseline = [
      { type: 'FOLLOW', quantity: 100, title: 'Suivez-nous', description: 'Suivez notre compte' },
      { type: 'LIKE', quantity: 150, title: 'Likez la publication', description: 'Likez la publication ciblée' },
      { type: 'COMMENT', quantity: 50, title: 'Commentez', description: 'Commentez la publication' },
    ];
    const typeCost: Record<string, number> = { LIKE: 30, FOLLOW: 60, COMMENT: 90, STORY: 160, POST: 310 };

    const types = baseline.map((t) => {
      let q = roundQty((t.quantity * scale) as number);
      q = Math.max(mins[t.type] ?? 5, q);
      return { ...t, quantity: q };
    });

    let totalCostCents = types.reduce((s, t) => s + (typeCost[t.type] ?? 0) * t.quantity, 0);
    const internalFeeCents = types.length * 10;
    let totalDebitCents = totalCostCents + internalFeeCents;
    let scaledDown = false;

    while (totalDebitCents > budgetCents && types.some((t) => t.quantity > (mins[t.type] ?? 5))) {
      const i = types.findIndex((t) => t.quantity > (mins[t.type] ?? 5));
      if (i < 0) break;
      scaledDown = true;
      types[i].quantity = Math.max(mins[types[i].type] ?? 5, roundQty(types[i].quantity - 10));
      totalCostCents = types.reduce((s, t) => s + (typeCost[t.type] ?? 0) * t.quantity, 0);
      totalDebitCents = totalCostCents + internalFeeCents;
    }
    totalDebitCents = Math.min(totalDebitCents, budgetCents);

    const notes = ['Recommandation pilote (LITE/STANDARD/BOOST). Ajustez le lien social avant de créer.'];
    if (scaledDown) notes.push('Ajusté selon budget disponible.');
    return {
      campaignName: 'Campagne visibilité',
      recommendedMissions: types,
      budgetBreakdown: { totalCostCents, internalFeeCents, totalDebitCents },
      notes,
    };
  }

  /** Risk summary for admin dashboard (top risks). */
  async riskSummary(riskData: { items: Array<{ userId: number; email?: string; riskScore?: number; submitsLastHour?: number; rejectRate?: number }> }, adminUserId?: number) {
    const input = { items: riskData.items.slice(0, 20) };
    if (!aiConfig().enabled) {
      const fallback = { summary: 'Risques basés sur les métriques. Vérifiez les utilisateurs à score élevé.', suggestedActions: ['Examiner manuellement les utilisateurs à risque'], factors: [] };
      await this.audit('RISK_SUMMARY', adminUserId, undefined, input, fallback);
      return fallback;
    }
    const raw = await this.aiClient.complete(PromptTemplates.RISK_SUMMARY, JSON.stringify(input));
    const parsed = raw ? parseJsonFromResponse(raw) : null;
    const output = validateRiskSummaryOutput(parsed);
    await this.audit('RISK_SUMMARY', adminUserId, undefined, input, output);
    return output;
  }

  /** Risk explanation for a single user (suggestions only). */
  async riskUser(userId: number, riskData: { riskScore?: number; submitsLastHour?: number; rejectRate?: number; avgTimeToSubmitMs?: number }, adminUserId?: number) {
    const input = { userId, ...riskData };
    if (!aiConfig().enabled) {
      const fallback = { explanation: 'Consulter l’historique et le score de confiance pour décider.', suggestedActions: ['Vérifier manuellement', 'Ajuster le plafond si nécessaire'], factors: [] };
      await this.audit('RISK_SUMMARY', adminUserId, undefined, input, fallback);
      return fallback;
    }
    const raw = await this.aiClient.complete(PromptTemplates.RISK_USER, JSON.stringify(input));
    const parsed = raw ? parseJsonFromResponse(raw) : null;
    const output = validateRiskUserOutput(parsed);
    await this.audit('RISK_SUMMARY', adminUserId, undefined, input, output);
    return output;
  }

  /** Mobile: top 3 mission recommendations (IDs from caller). */
  async mobileRecommendations(userId: number, missionIds: number[], missionSummaries: string[]) {
    const input = { missionIds, missionSummaries };
    if (!aiConfig().enabled) {
      return { recommendedIds: missionIds.slice(0, 3), reason: 'Priorité par ordre de liste.' };
    }
    const systemPrompt = 'You are an AQERA mobile coach. Given a list of mission summaries, return ONLY valid JSON: { "recommendedIds": [id1, id2, id3], "reason": "short string" }. recommendedIds = top 3 mission IDs from the list.';
    const raw = await this.aiClient.complete(systemPrompt, JSON.stringify(input));
    const parsed = raw ? parseJsonFromResponse(raw) : null;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).recommendedIds)) {
      const ids = (parsed as any).recommendedIds.filter((id: unknown) => typeof id === 'number' && missionIds.includes(id)).slice(0, 3);
      return { recommendedIds: ids.length ? ids : missionIds.slice(0, 3), reason: typeof (parsed as any).reason === 'string' ? (parsed as any).reason.slice(0, 200) : 'Suggestions par défaut.' };
    }
    return { recommendedIds: missionIds.slice(0, 3), reason: 'Suggestions par défaut.' };
  }

  /** Mobile: coach checklist before submit. */
  async mobileCoach(missionType: string, userId?: number) {
    const input = { missionType };
    if (!aiConfig().enabled) {
      const fallback = {
        checklist: ['Vérifier que l’action est bien réalisée', 'Respecter les consignes de la mission', 'Ne pas soumettre si la mission n’est pas terminée'],
        tip: 'Une soumission conforme augmente les chances de validation.',
      };
      await this.audit(AI_AUDIT_TYPES.MOBILE_COACH, userId, undefined, input, fallback);
      return fallback;
    }
    const raw = await this.aiClient.complete(PromptTemplates.MOBILE_COACH, JSON.stringify(input));
    const parsed = raw ? parseJsonFromResponse(raw) : null;
    const output = validateMobileCoachOutput(parsed);
    await this.audit(AI_AUDIT_TYPES.MOBILE_COACH, userId, undefined, input, output);
    return output;
  }
}
