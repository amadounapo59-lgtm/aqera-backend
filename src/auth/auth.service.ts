import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private normalizeEmail(email: string) {
    return (email ?? '').trim().toLowerCase();
  }

  private signToken(user: { id: number; email: string; role?: string }) {
    const payload = { sub: user.id, email: user.email, role: user.role ?? 'USER' };
    return this.jwt.sign(payload);
  }

  private userSelect = {
    id: true,
    email: true,
    name: true,
    balanceCents: true,
    badgeLevel: true,
    dailyCapCents: true,
    role: true,
    brandId: true,
    agencyId: true,
    mustChangePassword: true,
    createdAt: true,
  } as const;

  async register(email: string, password: string, name?: string) {
    const normalized = this.normalizeEmail(email);
    if (!normalized) throw new BadRequestException('Email obligatoire');
    if (!password || password.length < 8) {
      throw new BadRequestException('Mot de passe trop court (min 8 caractères)');
    }

    const existing = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (existing) throw new BadRequestException('Email déjà utilisé');

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: normalized,
        name: (name?.trim() ? name.trim() : normalized.split('@')[0]) ?? normalized,
        balanceCents: 0,
        passwordHash,
        role: 'USER',
        mustChangePassword: false,
      },
      select: this.userSelect,
    });

    const token = this.signToken(user);
    return { token, user };
  }

  async login(email: string, password: string) {
    const normalized = this.normalizeEmail(email);
    if (!normalized) throw new BadRequestException('Email obligatoire');
    if (!password) throw new BadRequestException('Mot de passe obligatoire');

    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
    });

    // Ne pas révéler si email existe ou pas
    if (!user || !user.passwordHash) throw new UnauthorizedException('Identifiants invalides');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Identifiants invalides');

    const safeUser = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: this.userSelect,
    });

    const token = this.signToken({ id: user.id, email: user.email, role: user.role ?? 'USER' });
    return { token, user: safeUser };
  }

  // ✅ pour temp password : BRAND se connecte puis doit changer
  async changePassword(userId: number, newPassword: string) {
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new BadRequestException('userId invalide');
    }

    const pwd = String(newPassword ?? '').trim();
    if (pwd.length < 8) throw new BadRequestException('Mot de passe trop court (min 8)');

    const hash = await bcrypt.hash(pwd, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: hash,
        mustChangePassword: false,
        tempPasswordIssuedAt: null,
      },
    });

    return { success: true, message: 'Mot de passe mis à jour ✅' };
  }
}