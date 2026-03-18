import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AnalyticsService } from '../analytics/analytics.service';
import { EventNames, EntityTypes } from '../analytics/events';
import { AiService } from '../ai/ai.service';
import { RateLimitService } from '../security/rate-limit.service';

const AI_RISK_RATE = 30;
const AI_RISK_WINDOW = 3600;

@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly analyticsService: AnalyticsService,
    private readonly aiService: AiService,
    private readonly rateLimit: RateLimitService,
  ) {}

  // ✅ GET /admin/attempts?status=PENDING
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('attempts')
  async listAttempts(@Req() req: any, @Query('status') status?: string) {
    const result = await this.adminService.listAttempts(status);
    await this.analyticsService.logEvent({
      userId: req.user.id,
      role: 'ADMIN',
      eventName: EventNames.admin_attempts_list_view,
      metadata: { status: status ?? 'all' },
    });
    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('stats')
  getStats(@Req() req: any) {
    return this.adminService.getStats(req.user.id);
  }

  // ✅ POST /admin/attempts/:id/approve
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('attempts/:id/approve')
  async approve(@Req() req: any, @Param('id') id: string) {
    const attemptId = Number(id);
    const result = await this.adminService.approveAttempt(req.user.id, attemptId);
    await this.analyticsService.logEvent({
      userId: req.user.id,
      role: 'ADMIN',
      eventName: EventNames.mission_attempt_approved,
      entityType: EntityTypes.MISSION_ATTEMPT,
      entityId: attemptId,
    });
    const creditedUserId = (result as any).creditedUserId;
    if (creditedUserId != null) {
      await this.analyticsService.logEvent({
        userId: creditedUserId,
        role: 'USER',
        eventName: EventNames.wallet_available_added,
        entityType: EntityTypes.WALLET,
        metadata: { amount_cents: (result as any).creditedCents, source: 'mission_approval' },
      }).catch(() => {});
    }
    return result;
  }

  // ✅ POST /admin/attempts/:id/reject
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('attempts/:id/reject')
  async reject(@Req() req: any, @Param('id') id: string) {
    const attemptId = Number(id);
    const result = await this.adminService.rejectAttempt(req.user.id, attemptId);
    await this.analyticsService.logEvent({
      userId: req.user.id,
      role: 'ADMIN',
      eventName: EventNames.mission_attempt_rejected,
      entityType: EntityTypes.MISSION_ATTEMPT,
      entityId: attemptId,
    });
    return result;
  }

  // ---------------------------
  // Missions à approuver (créées par les marques → visibles utilisateurs après approbation)
  // ---------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('missions')
  listMissions(@Req() req: any, @Query('status') status?: string) {
    return this.adminService.listMissions(req.user.id, status);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('missions/:id/approve')
  approveMission(@Req() req: any, @Param('id') id: string) {
    return this.adminService.approveMission(req.user.id, Number(id));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('missions/:id/reject')
  rejectMission(@Req() req: any, @Param('id') id: string) {
    return this.adminService.rejectMission(req.user.id, Number(id));
  }

  // ---------------------------
  // Comptes marque : liste, suspendre, supprimer, réactiver
  // ---------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('brands')
  listBrands(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listBrands(req.user.id, {
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('brands/:id/suspend')
  suspendBrand(@Req() req: any, @Param('id') id: string) {
    return this.adminService.suspendBrand(req.user.id, Number(id));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('brands/:id/delete')
  deleteBrand(@Req() req: any, @Param('id') id: string) {
    return this.adminService.deleteBrand(req.user.id, Number(id));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('brands/:id/reactivate')
  reactivateBrand(@Req() req: any, @Param('id') id: string) {
    return this.adminService.reactivateBrand(req.user.id, Number(id));
  }

  // ---------------------------
  // ✅ Brand applications
  // ---------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('brand-applications')
  listBrandApps(@Query('status') status?: string) {
    return this.adminService.listBrandApplications(status);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('brand-applications/:id/approve')
  async approveBrandApp(@Req() req: any, @Param('id') id: string) {
    const result = await this.adminService.approveBrandApplication(req.user.id, Number(id));
    await this.analyticsService.logEvent({
      userId: req.user.id,
      role: 'ADMIN',
      eventName: EventNames.admin_brand_application_approve_success,
      entityId: Number(id),
    });
    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('brand-applications/:id/reject')
  async rejectBrandApp(@Req() req: any, @Param('id') id: string) {
    const result = await this.adminService.rejectBrandApplication(req.user.id, Number(id));
    await this.analyticsService.logEvent({
      userId: req.user.id,
      role: 'ADMIN',
      eventName: EventNames.admin_brand_application_reject_success,
      entityId: Number(id),
    });
    return result;
  }

  // ---------------------------
  // Agency applications
  // ---------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('agency-applications')
  listAgencyApps(@Query('status') status?: string) {
    return this.adminService.listAgencyApplications(status);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('agency-applications/:id/approve')
  async approveAgencyApp(@Req() req: any, @Param('id') id: string) {
    const result = await this.adminService.approveAgencyApplication(req.user.id, Number(id));
    await this.analyticsService.logEvent({
      userId: req.user.id,
      role: 'ADMIN',
      eventName: EventNames.admin_agency_application_approve_success,
      entityId: Number(id),
    });
    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('agency-applications/:id/reject')
  async rejectAgencyApp(@Req() req: any, @Param('id') id: string) {
    const result = await this.adminService.rejectAgencyApplication(req.user.id, Number(id));
    await this.analyticsService.logEvent({
      userId: req.user.id,
      role: 'ADMIN',
      eventName: EventNames.admin_agency_application_reject_success,
      entityId: Number(id),
    });
    return result;
  }

  // ---------------------------
  // ✅ GiftCard Inventory (ADMIN)
  // ---------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('giftcards/inventory/import')
  importInventory(
    @Req() req: any,
    @Body()
    payload: {
      brandId: number;
      valueCents: number;
      codes: string[];
    },
  ) {
    return this.adminService.importGiftCardInventory(req.user.id, payload);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('giftcards/inventory')
  inventorySummary(@Req() req: any, @Query('brandId') brandId?: string) {
    return this.adminService.getGiftCardInventorySummary(
      req.user.id,
      brandId ? Number(brandId) : undefined,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('giftcards/codes/import')
  importGiftCardCodes(
    @Req() req: any,
    @Body() payload: { giftCardId: number; codes: string[] },
  ) {
    return this.adminService.importGiftCardCodes(req.user.id, payload ?? {});
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('giftcards/codes/summary')
  giftCardCodesSummary(@Req() req: any, @Query('brandId') brandId?: string) {
    return this.adminService.getGiftCardCodesSummary(
      req.user.id,
      brandId ? Number(brandId) : undefined,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('giftcards/codes')
  listGiftCardCodes(
    @Req() req: any,
    @Query('giftCardId') giftCardId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listGiftCardCodes(req.user.id, {
      giftCardId: giftCardId ? Number(giftCardId) : undefined,
      status: status?.trim(),
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('giftcards/codes/:id/void')
  voidGiftCardCode(@Req() req: any, @Param('id') id: string) {
    return this.adminService.voidGiftCardCode(req.user.id, parseInt(id, 10));
  }

  // ---------------------------
  // AQERA Platform budget & campaigns
  // ---------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('platform/budget')
  async getPlatformBudget(@Req() req: any) {
    const budget = await this.adminService.getPlatformBudget(req.user.id);
    await this.analyticsService.logEvent({
      userId: req.user.id,
      role: 'ADMIN',
      eventName: EventNames.admin_platform_budget_view,
    });
    return budget;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('metrics/daily')
  async getDailyMetrics(@Req() req: any, @Query('from') from: string, @Query('to') to: string) {
    const fromKey = (from ?? '').trim() || new Date().toISOString().slice(0, 10);
    const toKey = (to ?? '').trim() || fromKey;
    const result = await this.adminService.getDailyMetrics(req.user.id, fromKey, toKey);
    await this.analyticsService.logEvent({
      userId: req.user.id,
      role: 'ADMIN',
      eventName: EventNames.admin_daily_metrics_view,
      metadata: { from: fromKey, to: toKey },
    });
    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('risk/users')
  getRiskUsers(@Req() req: any, @Query('limit') limit?: string) {
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '50', 10) || 50));
    return this.adminService.getRiskUsers(req.user.id, limitNum);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('ai/risk/summary')
  async getAiRiskSummary(@Req() req: any, @Query('limit') limit?: string) {
    const limitNum = Math.min(50, Math.max(1, parseInt(limit ?? '20', 10) || 20));
    const res = await this.rateLimit.hit(`ai:admin:${req.user.id}`, AI_RISK_WINDOW, AI_RISK_RATE);
    if (!res.allowed) {
      throw new HttpException(
        { code: 'RATE_LIMIT', message: 'Trop de requêtes.', resetAt: res.resetAt.toISOString() },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const { users } = await this.adminService.getRiskUsers(req.user.id, limitNum);
    return this.aiService.riskSummary(
      { items: users.map((u) => ({ userId: u.userId, email: u.email, riskScore: u.riskScore, submitsLastHour: u.submitsLastHour, rejectRate: u.rejectRate })) },
      req.user.id,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('ai/risk/user/:userId')
  async postAiRiskUser(@Req() req: any, @Param('userId') userIdParam: string) {
    const userId = parseInt(userIdParam, 10);
    if (!Number.isFinite(userId)) throw new HttpException({ message: 'Invalid userId' }, HttpStatus.BAD_REQUEST);
    const res = await this.rateLimit.hit(`ai:admin:${req.user.id}`, AI_RISK_WINDOW, AI_RISK_RATE);
    if (!res.allowed) {
      throw new HttpException(
        { code: 'RATE_LIMIT', message: 'Trop de requêtes.', resetAt: res.resetAt.toISOString() },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const { users } = await this.adminService.getRiskUsers(req.user.id, 200);
    const row = users.find((u) => u.userId === userId);
    const riskData = row
      ? { riskScore: row.riskScore, submitsLastHour: row.submitsLastHour, rejectRate: row.rejectRate, avgTimeToSubmitMs: row.avgTimeToSubmitMs ?? undefined }
      : {};
    return this.aiService.riskUser(userId, riskData, req.user.id);
  }

  // ---------------------------
  // Analytics KPI V2/V3
  // ---------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('analytics/recompute')
  analyticsRecompute(
    @Req() req: any,
    @Body() body: { dateKey?: string; recomputeScores?: boolean; recomputePerformance?: boolean },
  ) {
    return this.adminService.analyticsRecompute(req.user.id, body ?? {});
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('analytics/userscores')
  getUserScores(@Req() req: any, @Query('limit') limit?: string) {
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '50', 10) || 50));
    return this.adminService.getUserScores(req.user.id, limitNum);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('analytics/mission-performance')
  getMissionPerformance(@Req() req: any) {
    return this.adminService.getMissionPerformance(req.user.id);
  }

  // ---------------------------
  // Admin alerts (pilote)
  // ---------------------------
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('alerts')
  listAlerts(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listAlerts(req.user.id, {
      status: status?.trim() || undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('alerts/:id/ack')
  ackAlert(@Req() req: any, @Param('id') id: string) {
    return this.adminService.ackAlert(req.user.id, parseInt(id, 10));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('alerts/:id/resolve')
  resolveAlert(@Req() req: any, @Param('id') id: string) {
    return this.adminService.resolveAlert(req.user.id, parseInt(id, 10));
  }

  // ---------------------------
  // Admin user actions (cap, status, risk)
  // ---------------------------
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('users/:id/cap')
  updateUserCap(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { dailyCapCents: number },
  ) {
    return this.adminService.updateUserCap(req.user.id, parseInt(id, 10), body?.dailyCapCents ?? 0);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('users/:id/status')
  updateUserStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { isBlocked: boolean },
  ) {
    return this.adminService.updateUserStatus(req.user.id, parseInt(id, 10), body?.isBlocked ?? false);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('users/:id/risk')
  updateUserRisk(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { riskLevel?: string; trustScore?: number },
  ) {
    return this.adminService.updateUserRisk(req.user.id, parseInt(id, 10), body ?? {});
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('users/:id/ban')
  banUser(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { isBanned: boolean; reason?: string },
  ) {
    return this.adminService.banUser(req.user.id, parseInt(id, 10), body?.isBanned ?? false, body?.reason);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('users/:id/verify-email')
  verifyUserEmail(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { emailVerified: boolean },
  ) {
    return this.adminService.verifyUserEmail(req.user.id, parseInt(id, 10), body?.emailVerified ?? false);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('security/events')
  getSecurityEvents(
    @Req() req: any,
    @Query('type') type?: string,
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getSecurityEvents(req.user.id, type, userId ? parseInt(userId, 10) : undefined, limit ? parseInt(limit, 10) : 100);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('campaigns')
  listCampaigns(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listCampaigns(req.user.id, page ? parseInt(page, 10) : undefined, limit ? parseInt(limit, 10) : 50);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('accounting/summary')
  getAccountingSummary(@Req() req: any) {
    return this.adminService.getAccountingSummary(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('accounting/reconcile')
  reconcileAccounting(@Req() req: any) {
    return this.adminService.reconcileAccounting(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('platform/campaigns')
  createPlatformCampaign(
    @Req() req: any,
    @Body()
    body: {
      platform: string;
      missionTypeCode: string;
      quantity: number;
      title: string;
      description: string;
      actionUrl: string;
    },
  ) {
    return this.adminService.createPlatformCampaign(req.user.id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('platform/campaigns')
  listPlatformCampaigns(@Req() req: any) {
    return this.adminService.listPlatformCampaigns(req.user.id);
  }
}