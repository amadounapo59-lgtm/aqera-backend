import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BrandsService } from './brands.service';
import { CampaignRoiService } from './campaign-roi.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AnalyticsService } from '../analytics/analytics.service';
import { EventNames, EntityTypes } from '../analytics/events';

/**
 * Brands (public) + Brand Dashboard (authenticated)
 *
 * Public:
 *  - POST /brands/apply
 *
 * Brand dashboard:
 *  - GET  /brands/me
 *  - GET  /brands/missions
 *  - POST /brands/missions
 *  - PATCH /brands/missions/:id
 *  - POST /brands/missions/:id/activate
 *  - POST /brands/missions/:id/pause
 *  - GET  /brands/stats
 */

@Controller('brands')
export class BrandsController {
  constructor(
    private readonly brandsService: BrandsService,
    private readonly campaignRoiService: CampaignRoiService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  // -------------------------
  // PUBLIC
  // -------------------------

  // ✅ Public: brand application
  @Post('apply')
  apply(@Body() body: any) {
    return this.brandsService.createBrandApplication(body);
  }

  // ✅ Public: popular brands (home discovery)
  @Get('popular')
  getPopular(@Query('limit') limit?: string) {
    const limitNum = limit != null ? Math.min(50, Math.max(1, parseInt(limit, 10) || 10)) : 10;
    return this.brandsService.getPopularBrands(limitNum);
  }

  // ✅ Public: brands grouped by category (discovery)
  @Get('by-category')
  getByCategory() {
    return this.brandsService.getBrandsByCategory();
  }

  // -------------------------
  // BRAND DASHBOARD (BRAND / AGENCY)
  // -------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'AGENCY')
  @Get('me')
  me(@Req() req: any, @Query('brandId') brandId?: string) {
    return this.brandsService.getBrandMe(req.user, brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'AGENCY')
  @Patch('me')
  updateMe(@Req() req: any, @Body() body: any, @Query('brandId') brandId?: string) {
    return this.brandsService.updateBrandMe(req.user, body, brandId ? Number(brandId) : undefined);
  }

  // ✅ Upload logo image (multipart/form-data, field name: logo)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'AGENCY')
  @Post('me/logo')
  @UseInterceptors(FileInterceptor('logo'))
  uploadLogo(
    @Req() req: any,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number; originalname?: string } | undefined,
    @Query('brandId') brandId?: string,
  ) {
    return this.brandsService.uploadLogo(req.user, file, brandId ? Number(brandId) : undefined);
  }

  // ✅ Upload cover image (multipart/form-data, field name: cover)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'AGENCY')
  @Post('me/cover')
  @UseInterceptors(FileInterceptor('cover'))
  uploadCover(
    @Req() req: any,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number; originalname?: string } | undefined,
    @Query('brandId') brandId?: string,
  ) {
    return this.brandsService.uploadCover(req.user, file, brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'AGENCY')
  @Get('missions')
  listMissions(@Req() req: any, @Query('brandId') brandId?: string) {
    return this.brandsService.listMissions(req.user, brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'AGENCY')
  @Post('missions')
  async createMission(@Req() req: any, @Body() body: any, @Query('brandId') brandId?: string) {
    if (brandId) body.brandId = Number(brandId);
    const user = req.user;
    await this.analyticsService.logEvent({
      userId: user.id,
      role: user.role,
      eventName: EventNames.brand_mission_create_attempt,
      entityType: EntityTypes.BRAND,
      entityId: body.brandId ?? undefined,
      metadata: {
        mission_type_code: body.missionTypeCode ?? body.missionTypeId,
        platform: body.platform,
        quantity: body.quantityTotal ?? body.quantity,
      },
    });
    try {
      const result = await this.brandsService.createMission(user, body);
      const mission = (result as any).mission;
      const mt = mission?.missionType;
      await this.analyticsService.logEvent({
        userId: user.id,
        role: user.role,
        eventName: EventNames.brand_mission_create_success,
        entityType: EntityTypes.BRAND,
        entityId: mission?.brandId ?? body.brandId,
        metadata: {
          brand_id: mission?.brandId ?? body.brandId,
          mission_type_code: mt?.code ?? body.missionTypeCode,
          platform: mission?.platform ?? body.platform,
          quantity: mission?.quantityTotal ?? body.quantityTotal,
          user_reward_cents: mt?.userRewardCents,
          brand_cost_cents: mt?.brandCostCents,
          total_brand_debit_cents: (result as any).totalCostCents,
        },
      });
      return result;
    } catch (err) {
      await this.analyticsService.logEvent({
        userId: user.id,
        role: user.role,
        eventName: EventNames.brand_mission_create_failed,
        entityType: EntityTypes.BRAND,
        entityId: body.brandId ?? undefined,
        metadata: {
          reason: err instanceof Error ? err.message : 'unknown',
          mission_type_code: body.missionTypeCode ?? body.missionTypeId,
          platform: body.platform,
          quantity: body.quantityTotal ?? body.quantity,
        },
      });
      throw err;
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'BRAND_STAFF', 'AGENCY')
  @Get('campaigns')
  listCampaigns(@Req() req: any, @Query('brandId') brandId?: string) {
    return this.brandsService.listCampaigns(req.user, brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'BRAND_STAFF', 'AGENCY')
  @Get('campaigns/:id')
  getCampaign(@Req() req: any, @Param('id') id: string, @Query('brandId') brandId?: string) {
    return this.brandsService.getCampaign(req.user, Number(id), brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'BRAND_STAFF', 'AGENCY')
  @Get('campaigns/:id/stats')
  getCampaignStats(@Req() req: any, @Param('id') id: string, @Query('brandId') brandId?: string) {
    return this.brandsService.getCampaignStats(req.user, Number(id), brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'BRAND_STAFF', 'AGENCY')
  @Get('campaigns/:id/roi')
  getCampaignRoi(@Req() req: any, @Param('id') id: string, @Query('brandId') brandId?: string) {
    return this.campaignRoiService.getCampaignRoi(req.user, Number(id), brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'BRAND_STAFF', 'AGENCY')
  @Get('settings')
  getBrandSettings(@Req() req: any, @Query('brandId') brandId?: string) {
    return this.brandsService.getBrandSettings(req.user, brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'BRAND_STAFF', 'AGENCY')
  @Patch('settings')
  updateBrandSettings(
    @Req() req: any,
    @Body() body: { avgOrderValueCents?: number; visitRateBps?: number; leadRateBps?: number; purchaseRateBps?: number },
    @Query('brandId') brandId?: string,
  ) {
    return this.brandsService.updateBrandSettings(req.user, body, brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'BRAND_STAFF', 'AGENCY')
  @Post('campaigns')
  async createCampaign(@Req() req: any, @Body() body: any, @Query('brandId') brandId?: string) {
    if (brandId) body.brandId = Number(brandId);
    const user = req.user;
    await this.analyticsService.logEvent({
      userId: user.id,
      role: user.role,
      eventName: EventNames.brand_campaign_create_attempt,
      entityType: EntityTypes.BRAND,
      entityId: body.brandId ?? undefined,
      metadata: { name: body.name, items_count: body.items?.length },
    });
    try {
      const result = await this.brandsService.createCampaign(user, body);
      const campaign = (result as any).campaign;
      await this.analyticsService.logEvent({
        userId: user.id,
        role: user.role,
        eventName: EventNames.brand_campaign_create_success,
        entityType: EntityTypes.BRAND,
        entityId: body.brandId ?? undefined,
        metadata: {
          campaign_id: campaign?.id,
          missions_count: (result as any).missions?.length,
          totalCostCents: (result as any).totalCostCents,
          internalFeeCents: (result as any).internalFeeCents,
          totalDebitCents: (result as any).totalDebitCents,
        },
      });
      return result;
    } catch (err) {
      await this.analyticsService.logEvent({
        userId: user.id,
        role: user.role,
        eventName: EventNames.brand_campaign_create_failed,
        entityType: EntityTypes.BRAND,
        entityId: body.brandId ?? undefined,
        metadata: { reason: (err as Error).message },
      });
      throw err;
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'AGENCY')
  @Patch('missions/:id')
  updateMission(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
    @Query('brandId') brandId?: string,
  ) {
    return this.brandsService.updateMission(req.user, Number(id), body, brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'AGENCY')
  @Post('missions/:id/activate')
  activateMission(@Req() req: any, @Param('id') id: string, @Query('brandId') brandId?: string) {
    return this.brandsService.setMissionStatus(req.user, Number(id), 'ACTIVE', brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'AGENCY')
  @Post('missions/:id/pause')
  pauseMission(@Req() req: any, @Param('id') id: string, @Query('brandId') brandId?: string) {
    return this.brandsService.setMissionStatus(req.user, Number(id), 'PAUSED', brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'AGENCY')
  @Get('stats')
  stats(@Req() req: any, @Query('brandId') brandId?: string) {
    return this.brandsService.getStats(req.user, brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'AGENCY')
  @Post('me/budget/deposit')
  depositBudget(@Req() req: any, @Body() body: { amountCents: number }, @Query('brandId') brandId?: string) {
    return this.brandsService.depositBudget(req.user, body?.amountCents, brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'AGENCY')
  @Post('me/budget/topup/preview')
  topupPreview(@Req() req: any, @Body() body: { amountCents: number }, @Query('brandId') brandId?: string) {
    return this.brandsService.topupPreview(req.user, body?.amountCents, brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'AGENCY')
  @Post('me/budget/topup/confirm')
  topupConfirm(
    @Req() req: any,
    @Body() body: { amountCents: number; denominations: { valueCents: number; quantity: number }[] },
    @Query('brandId') brandId?: string,
  ) {
    return this.brandsService.topupConfirm(req.user, body, brandId ? Number(brandId) : undefined);
  }

  // -------------------------
  // BRAND OWNER: Staff (employés)
  // -------------------------
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER')
  @Post('staff')
  createStaff(
    @Req() req: any,
    @Body() body: { email: string; name?: string },
    @Query('brandId') brandId?: string,
  ) {
    return this.brandsService.createStaff(req.user, body, brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER')
  @Get('staff')
  listStaff(@Req() req: any, @Query('brandId') brandId?: string) {
    return this.brandsService.listStaff(req.user, brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER')
  @Patch('staff/:id/disable')
  disableStaff(
    @Req() req: any,
    @Param('id') id: string,
    @Query('brandId') brandId?: string,
  ) {
    return this.brandsService.disableStaff(req.user, Number(id), brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER')
  @Patch('staff/:id/enable')
  enableStaff(
    @Req() req: any,
    @Param('id') id: string,
    @Query('brandId') brandId?: string,
  ) {
    return this.brandsService.enableStaff(req.user, Number(id), brandId ? Number(brandId) : undefined);
  }

  // ✅ Public: single brand by id (must be last so /me, /popular, /missions etc. match first)
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.brandsService.getBrandPublic(parseInt(id, 10));
  }
}
