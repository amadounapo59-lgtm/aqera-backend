// src/common/filters/all-exceptions.filter.ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

type ErrorBody = {
  statusCode: number;
  message: string;
  error?: string;
  timestamp: string;
  path: string;
  details?: any;
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    // 1) Default
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Une erreur est survenue';
    let error = 'Internal Server Error';
    let details: any = undefined;

    // 2) Nest HttpException (BadRequestException, ForbiddenException, etc.)
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse() as any;

      // r peut être string ou objet { message, error, ... }
      if (typeof r === 'string') {
        message = r;
      } else {
        const msg = r?.message;
        if (Array.isArray(msg)) message = msg.join('\n');
        else if (typeof msg === 'string') message = msg;
        else message = exception.message || 'Requête invalide';

        if (r?.error) error = r.error;
        else error = exception.name;

        // Si tu veux garder des infos techniques (optionnel)
        // details = r;
      }
    }

    // 3) Prisma errors (P2002, P2025, etc.)
    const prismaCode = exception?.code;
    if (typeof prismaCode === 'string' && prismaCode.startsWith('P')) {
      // Base
      status = HttpStatus.BAD_REQUEST;
      error = 'Database Error';

      // Messages "pro" (tu peux ajuster)
      if (prismaCode === 'P2002') {
        message = 'Valeur déjà utilisée (doublon)';
        status = HttpStatus.CONFLICT;
      } else if (prismaCode === 'P2025') {
        message = 'Ressource introuvable';
        status = HttpStatus.NOT_FOUND;
      } else if (prismaCode === 'P2028') {
        message = 'Opération trop lente, réessaie';
        status = HttpStatus.REQUEST_TIMEOUT;
      } else {
        message = 'Erreur de base de données';
      }

      // Garder le code dans details pour debug (en dev)
      details = { prismaCode, meta: exception?.meta };
    }

    // 4) Fetch JSON parse / autres erreurs inattendues
    if (!message || typeof message !== 'string') {
      message = 'Une erreur est survenue';
    }

    // 5) Log server-side (en dev utile, en prod ok aussi)
    // eslint-disable-next-line no-console
    console.error('[ERROR]', {
      status,
      path: req?.url,
      message,
      error,
      prismaCode,
      raw: exception?.message ?? exception,
    });

    const body: ErrorBody = {
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: req?.url ?? '',
      ...(details ? { details } : {}),
    };

    res.status(status).json(body);
  }
}