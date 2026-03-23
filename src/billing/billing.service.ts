import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';

export type AccountType = 'BRAND' | 'AGENCY';
/** Un seul plan commercial (ex. 49 CAD/mois) — valeur stockée en base / metadata Stripe. */
export type PlanCode = 'STANDARD';

function requiredEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

@Injectable()
export class BillingService {
  private stripe: Stripe | null = null;

  constructor(private readonly prisma: PrismaService) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (key) {
      this.stripe = new Stripe(key, { apiVersion: '2024-06-20' });
    }
  }

  private assertStripe() {
    if (!this.stripe) {
      throw new BadRequestException('Stripe non configuré (STRIPE_SECRET_KEY manquant)');
    }
    return this.stripe;
  }

  /**
   * Un seul Price Stripe (ex. 49 CAD/mois).
   * Priorité : STRIPE_PRICE_ID → repli legacy (même URL pour tous les comptes).
   */
  private getSubscriptionPriceId(): string {
    const single = process.env.STRIPE_PRICE_ID?.trim();
    if (single) return single;
    const legacy =
      process.env.STRIPE_PRICE_BRAND_STARTER?.trim() ||
      process.env.STRIPE_PRICE_AGENCY_STARTER?.trim();
    if (legacy) return legacy;
    throw new Error(
      'Missing Stripe price: set STRIPE_PRICE_ID=price_... (recommandé) ou STRIPE_PRICE_BRAND_STARTER / STRIPE_PRICE_AGENCY_STARTER en repli.',
    );
  }

  private trialDays(): number {
    const raw = process.env.STRIPE_TRIAL_DAYS;
    const n = raw ? parseInt(raw, 10) : 7;
    return Number.isFinite(n) && n >= 0 ? n : 7;
  }

  /**
   * Trial uniquement pour "nouveaux comptes":
   * - s'il existe déjà un stripeSubscriptionId en base => trial déjà consommé.
   * - sinon on vérifie l'historique Stripe du customer (si présent) ; s'il y a déjà eu
   *   un abonnement, on n'applique plus de trial.
   */
  private async canApplyTrialOnce(params: {
    accountType: AccountType;
    brandId?: number | null;
    agencyId?: number | null;
    stripeCustomerId?: string | null;
  }): Promise<boolean> {
    if (params.accountType === 'BRAND' && params.brandId) {
      const brand = await this.prisma.brand.findUnique({
        where: { id: params.brandId },
        select: { stripeSubscriptionId: true },
      });
      if (brand?.stripeSubscriptionId) return false;
    }
    if (params.accountType === 'AGENCY' && params.agencyId) {
      const agency = await this.prisma.agency.findUnique({
        where: { id: params.agencyId },
        select: { stripeSubscriptionId: true },
      });
      if (agency?.stripeSubscriptionId) return false;
    }
    if (!params.stripeCustomerId) return true;

    try {
      const subs = await this.assertStripe().subscriptions.list({
        customer: params.stripeCustomerId,
        status: 'all',
        limit: 1,
      });
      return subs.data.length === 0;
    } catch {
      // Si Stripe ne répond pas, on reste conservateur : pas de trial.
      return false;
    }
  }

  async getBillingStatus(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    if (user.role === 'BRAND') {
      if (!user.brandId) throw new BadRequestException('Brand manquante');
      const brand = await this.prisma.brand.findUnique({ where: { id: user.brandId } });
      return {
        accountType: 'BRAND' as const,
        plan: brand?.plan ?? 'FREE',
        subscriptionStatus: brand?.subscriptionStatus ?? null,
        trialEndsAt: brand?.trialEndsAt ?? null,
      };
    }

    if (user.role === 'AGENCY') {
      if (!user.agencyId) throw new BadRequestException('Agency manquante');
      const agency = await this.prisma.agency.findUnique({ where: { id: user.agencyId } });
      return {
        accountType: 'AGENCY' as const,
        plan: agency?.plan ?? 'FREE',
        subscriptionStatus: agency?.subscriptionStatus ?? null,
        trialEndsAt: agency?.trialEndsAt ?? null,
      };
    }

    throw new BadRequestException('Rôle non éligible au billing');
  }

  // Backward-compat alias (controller uses getStatus)
  async getStatus(userId: number) {
    return this.getBillingStatus(userId);
  }

  async createCheckoutSession(params: {
    userId: number;
    successUrl: string;
    cancelUrl: string;
  }) {
    const user = await this.prisma.user.findUnique({ where: { id: params.userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    const plan: PlanCode = 'STANDARD';
    const role = (user.role ?? 'USER').toUpperCase();

    if (role !== 'BRAND' && role !== 'AGENCY') {
      throw new BadRequestException('Seuls les comptes Marque ou Agence peuvent souscrire');
    }

    const accountType = role as AccountType;
    const priceId = this.getSubscriptionPriceId();

    // Resolve / create Stripe customer
    let stripeCustomerId: string | null = null;
    let customerEmail: string | undefined = undefined;
    let accountName: string | undefined = undefined;

    if (accountType === 'BRAND') {
      if (!user.brandId) throw new BadRequestException('Brand manquante');
      const brand = await this.prisma.brand.findUnique({ where: { id: user.brandId } });
      if (!brand) throw new BadRequestException('Brand introuvable');
      stripeCustomerId = brand.stripeCustomerId ?? null;
      customerEmail = user.email;
      accountName = brand.name;

      if (!stripeCustomerId) {
        const customer = await this.assertStripe().customers.create({
          email: customerEmail,
          name: accountName,
          metadata: { accountType: 'BRAND', brandId: String(brand.id) },
        });
        stripeCustomerId = customer.id;
        await this.prisma.brand.update({
          where: { id: brand.id },
          data: { stripeCustomerId },
        });
      }
    } else {
      if (!user.agencyId) throw new BadRequestException('Agency manquante');
      const agency = await this.prisma.agency.findUnique({ where: { id: user.agencyId } });
      if (!agency) throw new BadRequestException('Agency introuvable');
      stripeCustomerId = agency.stripeCustomerId ?? null;
      customerEmail = user.email;
      accountName = agency.name;

      if (!stripeCustomerId) {
        const customer = await this.assertStripe().customers.create({
          email: customerEmail,
          name: accountName,
          metadata: { accountType: 'AGENCY', agencyId: String(agency.id) },
        });
        stripeCustomerId = customer.id;
        await this.prisma.agency.update({
          where: { id: agency.id },
          data: { stripeCustomerId },
        });
      }
    }

    const trialEligible = await this.canApplyTrialOnce({
      accountType,
      brandId: user.brandId,
      agencyId: user.agencyId,
      stripeCustomerId,
    });
    const trialDays = trialEligible ? this.trialDays() : 0;

    const session = await this.assertStripe().checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId ?? undefined,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      subscription_data: {
        ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
        metadata: {
          accountType,
          plan,
          userId: String(user.id),
          brandId: user.brandId ? String(user.brandId) : '',
          agencyId: user.agencyId ? String(user.agencyId) : '',
        },
      },
      metadata: {
        accountType,
        plan,
        userId: String(user.id),
        brandId: user.brandId ? String(user.brandId) : '',
        agencyId: user.agencyId ? String(user.agencyId) : '',
      },
    });

    return { url: session.url };
  }

  async createPortalSession(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    const role = (user.role ?? 'USER').toUpperCase();
    let stripeCustomerId: string | null = null;

    if (role === 'BRAND') {
      if (!user.brandId) throw new BadRequestException('Brand manquante');
      const brand = await this.prisma.brand.findUnique({ where: { id: user.brandId } });
      stripeCustomerId = brand?.stripeCustomerId ?? null;
    } else if (role === 'AGENCY') {
      if (!user.agencyId) throw new BadRequestException('Agency manquante');
      const agency = await this.prisma.agency.findUnique({ where: { id: user.agencyId } });
      stripeCustomerId = agency?.stripeCustomerId ?? null;
    }

    if (!stripeCustomerId) {
      throw new BadRequestException('Aucun customer Stripe associé à ce compte');
    }

    const returnUrl =
      (process.env.WEB_DASHBOARD_URL ? process.env.WEB_DASHBOARD_URL.replace(/\/+$/, '') : null) ||
      'http://localhost:3001';

    const session = await this.assertStripe().billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  // ------------------- Webhooks -------------------
  getStripe() {
    return this.assertStripe();
  }

  async handleSubscriptionUpdate(sub: Stripe.Subscription) {
    const meta = (sub.metadata ?? {}) as Record<string, string>;
    const accountType = (meta.accountType ?? '').toUpperCase();
    const plan = (meta.plan ?? '').toUpperCase();

    const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
    const status = sub.status ? sub.status.toUpperCase() : null;

    if (accountType === 'BRAND') {
      const brandId = Number(meta.brandId);
      if (!brandId) return;
      await this.prisma.brand.update({
        where: { id: brandId },
        data: {
          stripeSubscriptionId: sub.id,
          subscriptionStatus: status,
          trialEndsAt: trialEnd,
          plan: plan || undefined,
        },
      });
      return;
    }

    if (accountType === 'AGENCY') {
      const agencyId = Number(meta.agencyId);
      if (!agencyId) return;
      await this.prisma.agency.update({
        where: { id: agencyId },
        data: {
          stripeSubscriptionId: sub.id,
          subscriptionStatus: status,
          trialEndsAt: trialEnd,
          plan: plan || undefined,
        },
      });
      return;
    }
  }

  async handleWebhook(rawBody: Buffer, signature: string) {
    const secret = requiredEnv('STRIPE_WEBHOOK_SECRET');
    const event = this.assertStripe().webhooks.constructEvent(rawBody, signature, secret);

    // We keep it intentionally minimal: only events that matter to keep billing state in sync.
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const subId = session.subscription as string | null;
      if (subId) {
        const sub = await this.assertStripe().subscriptions.retrieve(subId);
        await this.handleSubscriptionUpdate(sub);
      }
    }

    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const sub = event.data.object as Stripe.Subscription;
      await this.handleSubscriptionUpdate(sub);
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      // Mark as canceled in DB
      await this.handleSubscriptionUpdate({ ...sub, status: 'canceled' } as any);
    }

    return { received: true };
  }
}
