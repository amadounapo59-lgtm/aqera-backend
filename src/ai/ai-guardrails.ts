/**
 * Validate and sanitize AI JSON responses. Ensures outputs never exceed budget or violate business rules.
 */

export interface CampaignBuilderOutput {
  campaignName?: string;
  recommendedMissions?: Array<{
    type?: string;
    quantity?: number;
    title?: string;
    description?: string;
  }>;
  budgetBreakdown?: {
    totalCostCents?: number;
    internalFeeCents?: number;
    totalDebitCents?: number;
  };
  notes?: string[];
}

const VALID_TYPES = new Set(['FOLLOW', 'LIKE', 'COMMENT', 'STORY', 'POST']);
const TYPE_COST: Record<string, { userRewardCents: number; brandCostCents: number }> = {
  LIKE: { userRewardCents: 20, brandCostCents: 30 },
  FOLLOW: { userRewardCents: 50, brandCostCents: 60 },
  COMMENT: { userRewardCents: 80, brandCostCents: 90 },
  STORY: { userRewardCents: 150, brandCostCents: 160 },
  POST: { userRewardCents: 300, brandCostCents: 310 },
};

export function validateCampaignBuilderOutput(
  raw: unknown,
  maxBudgetCents: number,
): CampaignBuilderOutput {
  const out: CampaignBuilderOutput = { campaignName: '', recommendedMissions: [], budgetBreakdown: { totalCostCents: 0, internalFeeCents: 0, totalDebitCents: 0 }, notes: [] };
  if (!raw || typeof raw !== 'object') return out;

  const obj = raw as Record<string, unknown>;
  if (typeof obj.campaignName === 'string') out.campaignName = obj.campaignName.slice(0, 200);

  const missions: CampaignBuilderOutput['recommendedMissions'] = [];
  const arr = Array.isArray(obj.recommendedMissions) ? obj.recommendedMissions : [];
  let totalCostCents = 0;
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i];
    if (!m || typeof m !== 'object') continue;
    const type = String((m as any).type || '').toUpperCase();
    if (!VALID_TYPES.has(type)) continue;
    const costs = TYPE_COST[type];
    if (!costs) continue;
    const quantity = Math.max(0, Math.min(500, Math.floor(Number((m as any).quantity) || 0)));
    if (quantity === 0) continue;
    missions.push({
      type,
      quantity,
      title: typeof (m as any).title === 'string' ? (m as any).title.slice(0, 200) : `${type} mission`,
      description: typeof (m as any).description === 'string' ? (m as any).description.slice(0, 500) : '',
    });
    totalCostCents += costs.brandCostCents * quantity;
  }
  out.recommendedMissions = missions;
  const internalFeeCents = missions.length * 10;
  const totalDebitCents = Math.min(totalCostCents + internalFeeCents, maxBudgetCents);
  out.budgetBreakdown = {
    totalCostCents,
    internalFeeCents,
    totalDebitCents,
  };
  if (Array.isArray(obj.notes)) out.notes = obj.notes.filter((n) => typeof n === 'string').slice(0, 10).map((s) => String(s).slice(0, 300));
  return out;
}

export function validateRiskSummaryOutput(raw: unknown): { summary: string; suggestedActions: string[]; factors: string[] } {
  const def = { summary: '', suggestedActions: [] as string[], factors: [] as string[] };
  if (!raw || typeof raw !== 'object') return def;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.summary === 'string') def.summary = obj.summary.slice(0, 1000);
  if (Array.isArray(obj.suggestedActions)) def.suggestedActions = obj.suggestedActions.filter((a) => typeof a === 'string').slice(0, 10).map((s) => String(s).slice(0, 200));
  if (Array.isArray(obj.factors)) def.factors = obj.factors.filter((f) => typeof f === 'string').slice(0, 10);
  return def;
}

export function validateRiskUserOutput(raw: unknown): { explanation: string; suggestedActions: string[]; factors: string[] } {
  const def = { explanation: '', suggestedActions: [] as string[], factors: [] as string[] };
  if (!raw || typeof raw !== 'object') return def;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.explanation === 'string') def.explanation = obj.explanation.slice(0, 1000);
  if (Array.isArray(obj.suggestedActions)) def.suggestedActions = obj.suggestedActions.filter((a) => typeof a === 'string').slice(0, 10).map((s) => String(s).slice(0, 200));
  if (Array.isArray(obj.factors)) def.factors = obj.factors.filter((f) => typeof f === 'string').slice(0, 10);
  return def;
}

export function validateMobileCoachOutput(raw: unknown): { checklist: string[]; tip: string } {
  const def = { checklist: [] as string[], tip: '' };
  if (!raw || typeof raw !== 'object') return def;
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.checklist)) def.checklist = obj.checklist.filter((c) => typeof c === 'string').slice(0, 5).map((s) => String(s).slice(0, 200));
  if (typeof obj.tip === 'string') def.tip = obj.tip.slice(0, 300);
  return def;
}

/** Parse JSON from LLM response (strip markdown code blocks if present). */
export function parseJsonFromResponse(text: string): unknown {
  let s = (text || '').trim();
  const codeBlock = /^```(?:json)?\s*([\s\S]*?)```$/;
  const m = s.match(codeBlock);
  if (m) s = m[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
