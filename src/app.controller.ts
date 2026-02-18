// src/app.controller.ts
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  // ✅ Healthcheck simple
  @Get()
  getHello() {
    return { message: 'AQERA backend OK' };
  }

  // ✅ Used by web/mobile to verify API is up
  @Get('health')
  health() {
    return { ok: true };
  }
}