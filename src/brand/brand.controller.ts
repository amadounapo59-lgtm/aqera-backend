import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { BrandService } from './brand.service';
import { CampaignRoiService } from '../brands/campaign-roi.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RateLimitService } from '../security/rate-limit.service';
import { SecurityEventService } from '../security/security-event.service';
import { securityConfig } from '../security/security.config';
import { AiService } from '../ai/ai.service';

const AI_CAMPAIGN_RATE = 20;
const AI_CAMPAIGN_WINDOW = 3600;

@Controller('brand')
export class BrandController {
  constructor(
    private readonly brandService: BrandService,
    private readonly campaignRoiService: CampaignRoiService,
    private readonly rateLimit: RateLimitService,
    private readonly securityEvents: SecurityEventService,
    private readonly aiService: AiService,
  ) {}

  /** Info route: évite 404 quand on accède à /brand (ex. favori ou navigation vers l’API). */
  @Get()
  brandInfo() {
    return { message: 'AQERA Brand API', endpoints: ['POST /brand/redeem', 'GET /brand/redeems', 'POST /brand/ai/campaign-builder'] };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'BRAND_STAFF')
  @Post('redeem')
  async redeem(@Req() req: any, @Body() body: { code?: string }) {
    const secCtx = req.securityContext ?? { ip: 'unknown', deviceId: 'unknown' };
    if (securityConfig.rateLimitEnabled) {
      const res = await this.rateLimit.hit(
        `staff:redeem:${req.user.id}`,
        900,
        securityConfig.redeemPerStaffPer15Min,
      );
      if (!res.allowed) {
        throw new HttpException(
          {
            code: 'RATE_LIMIT',
            message: 'Trop de validations. Réessaie dans quelques minutes.',
            resetAt: res.resetAt.toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    const out = await this.brandService.redeemCode(req.user.id, body?.code ?? '');
    await this.securityEvents.log('REDEEM', {
      userId: req.user.id,
      ip: secCtx.ip,
      deviceId: secCtx.deviceId,
      meta: {
        purchaseId: (out as any)?.purchaseId,
        valueCents: (out as any)?.valueCents,
        brandName: (out as any)?.brandName,
      },
    });
    return out;
  }

  /** Alias for /brands/campaigns/:id/roi (dashboard may call /brand/campaigns/:id/roi). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'BRAND_STAFF', 'AGENCY')
  @Get('campaigns/:id/roi')
  getCampaignRoi(@Req() req: any, @Param('id') id: string, @Query('brandId') brandId?: string) {
    return this.campaignRoiService.getCampaignRoi(req.user, Number(id), brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'BRAND_STAFF')
  @Get('redeems')
  redeems(@Req() req: any, @Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.brandService.getRedeems(req.user.id, limitNum);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'BRAND_OWNER', 'BRAND_STAFF')
  @Post('ai/campaign-builder')
  async aiCampaignBuilder(
    @Req() req: any,
    @Body()
    body: {
      objective?: string;
      budgetCents?: number;
      durationDays?: number;
      platforms?: string[];
      city?: string;
      campaignSize?: 'LITE' | 'STANDARD' | 'BOOST';
    },
  ) {
    const userId = req.user?.id;
    const brandId = req.user?.brandId ?? (body as any)?.brandId;
    if (!brandId) throw new HttpException({ message: 'Brand context required' }, HttpStatus.BAD_REQUEST);
    const res = await this.rateLimit.hit(`ai:campaign:${brandId}`, AI_CAMPAIGN_WINDOW, AI_CAMPAIGN_RATE);
    if (!res.allowed) {
      throw new HttpException(
        { code: 'RATE_LIMIT', message: 'Trop de requêtes. Réessaie plus tard.', resetAt: res.resetAt.toISOString() },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.aiService.campaignBuilder(
      {
        objective: body?.objective ?? '',
        budgetCents: Number(body?.budgetCents) || 0,
        durationDays: Number(body?.durationDays) || 7,
        platforms: Array.isArray(body?.platforms) ? body.platforms : [],
        city: body?.city,
        campaignSize: body?.campaignSize ?? 'STANDARD',
      },
      brandId,
      userId,
    );
  }
}
