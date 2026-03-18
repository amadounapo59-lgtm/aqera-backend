import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { securityConfig, SecurityContext } from './security.config';

declare global {
  namespace Express {
    interface Request {
      securityContext?: SecurityContext;
    }
  }
}

@Injectable()
export class SecurityContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) ||
      req.ip ||
      (req.socket && (req.socket as any).remoteAddress) ||
      'unknown';
    const raw = req.headers[securityConfig.deviceHeader];
    const deviceId =
      typeof raw === 'string' ? (raw.trim() || 'unknown') : Array.isArray(raw) ? (raw[0] ?? 'unknown') : 'unknown';
    req.securityContext = { ip, deviceId };
    next();
  }
}
