import { Body, Controller, Post } from '@nestjs/common';
import { AgencyApplicationsService } from './agency-applications.service';

@Controller('agency-applications')
export class AgencyApplicationsController {
  constructor(private readonly service: AgencyApplicationsService) {}

  // ✅ POST /agency-applications (public)
  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }
}
