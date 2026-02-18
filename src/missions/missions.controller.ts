import { Controller, Get, Param, Post, Req, UseGuards, ParseIntPipe } from '@nestjs/common';
import { MissionsService } from './missions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('missions')
export class MissionsController {
  constructor(private readonly missionsService: MissionsService) {}

  // ✅ User: voir ses tentatives + statuts
  @UseGuards(JwtAuthGuard)
  @Get('my-attempts')
  myAttempts(@Req() req: any) {
    return this.missionsService.getMyAttempts(req.user.id);
  }

  // ✅ Liste des missions actives (avec attemptStatus si connecté)
  @UseGuards(JwtAuthGuard)
  @Get()
  findActive(@Req() req: any) {
    return this.missionsService.findActiveForUser(req.user.id);
  }

  // ✅ User: “J’ai terminé” => attempt PENDING (pas de crédit ici)
  @UseGuards(JwtAuthGuard)
  @Post(':missionId/submit')
  submitAttempt(
    @Req() req: any,
    @Param('missionId', ParseIntPipe) missionId: number,
  ) {
    return this.missionsService.submitAttempt(req.user.id, missionId);
  }
}