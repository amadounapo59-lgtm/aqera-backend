import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.AUTH_SECRET || 'dev_secret_change_me',
    });
  }

  async validate(payload: any) {
    // payload = { sub, email, role }
    // IMPORTANT: many services need brandId / agencyId to authorize actions.
    // We re-hydrate the user from DB to avoid relying on stale JWT claims.

    const id = Number(payload?.sub);
    if (!Number.isFinite(id) || id <= 0) {
      return { id: payload?.sub, email: payload?.email, role: payload?.role };
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        brandId: true,
        agencyId: true,
      },
    });

    if (!user) {
      return { id, email: payload?.email, role: payload?.role };
    }

    return {
      id: user.id,
      email: user.email,
      role: (user.role ?? payload?.role ?? 'USER') as any,
      brandId: user.brandId ?? undefined,
      agencyId: user.agencyId ?? undefined,
    };
  }
}
