import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AiService } from './ai.service';
import { RateLimitService } from '../security/rate-limit.service';
import { MissionsService } from '../missions/missions.service';

const AI_RATE_LIMIT_PER_USER = 30; // per hour
const AI_RATE_WINDOW = 3600;

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly rateLimit: RateLimitService,
    private readonly missionsService: MissionsService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('USER', 'CREATOR')
  @Get('mobile/recommendations')
  async mobileRecommendations(@Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new HttpException({ message: 'Unauthorized' }, HttpStatus.UNAUTHORIZED);
    const res = await this.rateLimit.hit(`ai:mobile:${userId}`, AI_RATE_WINDOW, AI_RATE_LIMIT_PER_USER);
    if (!res.allowed) {
      throw new HttpException(
        { code: 'RATE_LIMIT', message: 'Trop de requêtes. Réessaie plus tard.', resetAt: res.resetAt.toISOString() },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    let missionIds: number[] = [];
    let summaries: string[] = [];
    try {
      const data = await this.missionsService.findActiveForUser(userId);
      const available = data?.availableMissions ?? data?.missions ?? [];
      missionIds = available.map((m: any) => m.id ?? m.missionId).filter((n: unknown) => typeof n === 'number');
      summaries = available.map((m: any) => `${m.title || ''} (${m.type?.code || 'mission'})`).slice(0, 20);
    } catch {
      // ignore
    }
    return this.aiService.mobileRecommendations(userId, missionIds, summaries);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('USER', 'CREATOR')
  @Post('mobile/coach')
  async mobileCoach(@Req() req: any, @Body() body: { missionType?: string }) {
    const userId = req.user?.id;
    const res = await this.rateLimit.hit(`ai:mobile:${userId || 'anon'}`, AI_RATE_WINDOW, AI_RATE_LIMIT_PER_USER);
    if (!res.allowed) {
      throw new HttpException(
        { code: 'RATE_LIMIT', message: 'Trop de requêtes.', resetAt: res.resetAt.toISOString() },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.aiService.mobileCoach(body?.missionType || 'MISSION', userId);
  }
}
