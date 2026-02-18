import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BillingService } from './billing.service';
import type { PlanCode } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // Current subscription status for logged account (BRAND or AGENCY)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'AGENCY')
  @Get('status')
  status(@Req() req: any) {
    return this.billing.getStatus(req.user.id);
  }

  // Create Checkout Session (Subscription + 14-day trial)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'AGENCY')
  @Post('checkout-session')
  async createCheckoutSession(
    @Req() req: any,
    @Body('plan') plan: PlanCode,
    @Body('successUrl') successUrl?: string,
    @Body('cancelUrl') cancelUrl?: string,
  ) {
    const base =
      (process.env.WEB_DASHBOARD_URL ? process.env.WEB_DASHBOARD_URL.replace(/\/+$/, '') : null) ||
      (process.env.WEBAPP_URL ? process.env.WEBAPP_URL.replace(/\/+$/, '') : null);
    const okUrl = successUrl || (base ? `${base}/billing/success` : 'http://localhost:3001/billing/success');
    const koUrl = cancelUrl || (base ? `${base}/billing/cancel` : 'http://localhost:3001/billing/cancel');
    return this.billing.createCheckoutSession({
      userId: req.user.id,
      plan,
      successUrl: okUrl,
      cancelUrl: koUrl,
    });
  }

  // Create Billing Portal link
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'AGENCY')
  @Post('portal')
  portal(@Req() req: any) {
    return this.billing.createPortalSession(req.user.id);
  }
}
