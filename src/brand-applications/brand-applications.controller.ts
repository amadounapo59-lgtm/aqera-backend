import { Body, Controller, Post } from '@nestjs/common';
import { BrandApplicationsService } from './brand-applications.service';

@Controller('brand-applications')
export class BrandApplicationsController {
  constructor(private readonly service: BrandApplicationsService) {}

  // ✅ POST /brand-applications
  @Post()
  create(@Body() body: any) {
    // Accept both legacy keys (contactEmail/brandName) and canonical (email/businessName)
    const dto = {
      email: body?.email ?? body?.contactEmail,
      businessName: body?.businessName ?? body?.brandName,
      phone: body?.phone,
      address: body?.address,
      city: body?.city,
      province: body?.province,
      country: body?.country,
      website: body?.website,
      instagram: body?.instagram,
      category: body?.category,
    };
    return this.service.createApplication(dto as any);
  }
}