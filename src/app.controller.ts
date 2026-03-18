// src/app.controller.ts
import { Controller, Get, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from './prisma/prisma.service';

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || '3001';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  // ✅ Healthcheck : JSON pour l’API, HTML pour le navigateur (lien vers le dashboard)
  @Get()
  getHello(@Req() req: { get?: (name: string) => string }, @Res({ passthrough: true }) res: Response) {
    // Allow safe unit-test calls where `req` might be undefined.
    const accept = req?.get?.('Accept') ?? '';
    if (accept.includes('text/html')) {
      const host = req?.get?.('Host')?.split(':')[0] || 'localhost';
      const dashboardUrl = `http://${host}:${DASHBOARD_PORT}`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AQERA API</title></head><body style="font-family:sans-serif;max-width:32rem;margin:4rem auto;padding:1rem;"><h1>AQERA API</h1><p>Ceci est le backend. Pour ouvrir le <strong>dashboard</strong> :</p><p><a href="${dashboardUrl}" style="font-size:1.25rem;">${dashboardUrl}</a></p><p><small>Réponse JSON : <a href="/">/</a></small></p></body></html>`,
      );
      return;
    }
    return { message: 'AQERA backend OK' };
  }

  // ✅ Used by web/mobile + load balancer: checks DB, returns 503 if unavailable
  @Get('health')
  async health() {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return { ok: true, db: 'up' };
    } catch {
      throw new ServiceUnavailableException({ ok: false, db: 'down' });
    }
  }
}