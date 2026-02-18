import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ✅ GET /admin/attempts?status=PENDING
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('attempts')
  listAttempts(@Query('status') status?: string) {
    return this.adminService.listAttempts(status);
  }

  // ✅ POST /admin/attempts/:id/approve
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('attempts/:id/approve')
  approve(@Req() req: any, @Param('id') id: string) {
    return this.adminService.approveAttempt(req.user.id, Number(id));
  }

  // ✅ POST /admin/attempts/:id/reject
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('attempts/:id/reject')
  reject(@Req() req: any, @Param('id') id: string) {
    return this.adminService.rejectAttempt(req.user.id, Number(id));
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
  approveBrandApp(@Req() req: any, @Param('id') id: string) {
    return this.adminService.approveBrandApplication(req.user.id, Number(id));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('brand-applications/:id/reject')
  rejectBrandApp(@Req() req: any, @Param('id') id: string) {
    return this.adminService.rejectBrandApplication(req.user.id, Number(id));
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
  approveAgencyApp(@Req() req: any, @Param('id') id: string) {
    return this.adminService.approveAgencyApplication(req.user.id, Number(id));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('agency-applications/:id/reject')
  rejectAgencyApp(@Req() req: any, @Param('id') id: string) {
    return this.adminService.rejectAgencyApplication(req.user.id, Number(id));
  }

  // ---------------------------
  // ✅ Brand Budgets (ADMIN)
  // ---------------------------

  // POST /admin/brands/:id/budget/topup { amountCents }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('brands/:id/budget/topup')
  topupBrandBudget(@Req() req: any, @Param('id') id: string, @Body('amountCents') amountCents: number) {
    return this.adminService.topupBrandBudget(req.user.id, Number(id), Number(amountCents));
  }

  // GET /admin/brands/:id/budget
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('brands/:id/budget')
  getBrandBudget(@Req() req: any, @Param('id') id: string) {
    return this.adminService.getBrandBudget(req.user.id, Number(id));
  }
}