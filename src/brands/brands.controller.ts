import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BrandsService } from './brands.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

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
  constructor(private readonly brandsService: BrandsService) {}

  // -------------------------
  // PUBLIC
  // -------------------------

  // ✅ Public: brand application
  @Post('apply')
  apply(@Body() body: any) {
    return this.brandsService.createBrandApplication(body);
  }

  // -------------------------
  // BRAND DASHBOARD (BRAND / AGENCY)
  // -------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'AGENCY')
  @Get('me')
  me(@Req() req: any, @Query('brandId') brandId?: string) {
    return this.brandsService.getBrandMe(req.user, brandId ? Number(brandId) : undefined);
  }

  // ✅ Update brand profile (for Brand/Agency settings page)
  // Notes:
  // - BRAND can only update its own brand
  // - AGENCY can update any brand it has access to (by brandId)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'AGENCY')
  @Patch('me')
  updateMe(@Req() req: any, @Body() body: any, @Query('brandId') brandId?: string) {
    return this.brandsService.updateBrandMe(req.user, body, brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'AGENCY')
  @Get('missions')
  listMissions(@Req() req: any, @Query('brandId') brandId?: string) {
    return this.brandsService.listMissions(req.user, brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'AGENCY')
  @Post('missions')
  createMission(@Req() req: any, @Body() body: any, @Query('brandId') brandId?: string) {
    // brandId is supported via body.brandId (and resolved in the service)
    if (brandId) body.brandId = Number(brandId);
    return this.brandsService.createMission(req.user, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'AGENCY')
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
  @Roles('BRAND', 'AGENCY')
  @Post('missions/:id/activate')
  activateMission(@Req() req: any, @Param('id') id: string, @Query('brandId') brandId?: string) {
    return this.brandsService.setMissionStatus(req.user, Number(id), 'ACTIVE', brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'AGENCY')
  @Post('missions/:id/pause')
  pauseMission(@Req() req: any, @Param('id') id: string, @Query('brandId') brandId?: string) {
    return this.brandsService.setMissionStatus(req.user, Number(id), 'PAUSED', brandId ? Number(brandId) : undefined);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND', 'AGENCY')
  @Get('stats')
  stats(@Req() req: any, @Query('brandId') brandId?: string) {
    return this.brandsService.getStats(req.user, brandId ? Number(brandId) : undefined);
  }
}
