import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { isDisposableEmailDomain } from './disposable-email-domains';
import { securityConfig } from '../security/security.config';

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
    isActive: true,
    emailVerified: true,
    createdAt: true,
    lastActiveAt: true,
  } as const;

  private validateEmailFormat(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private validatePasswordStrength(password: string): void {
    if (!password || password.length < 8) {
      throw new BadRequestException('Le mot de passe doit faire au moins 8 caractères.');
    }
    if (!/[A-Z]/.test(password)) {
      throw new BadRequestException('Le mot de passe doit contenir au moins une majuscule.');
    }
    if (!/[0-9]/.test(password)) {
      throw new BadRequestException('Le mot de passe doit contenir au moins un chiffre.');
    }
  }

  async register(email: string, password: string, name?: string, fullName?: string) {
    const normalized = this.normalizeEmail(email);
    if (!normalized) throw new BadRequestException('Email obligatoire');
    if (!this.validateEmailFormat(normalized)) {
      throw new BadRequestException('Format d\'email invalide.');
    }
    // Bloquer les domaines d’emails jetables (sauf si désactivé en config)
    if (securityConfig.blockDisposableEmailDomains) {
      const domain = normalized.split('@')[1] ?? '';
      if (isDisposableEmailDomain(domain)) {
        throw new BadRequestException(
          'Les adresses email temporaires ou jetables ne sont pas acceptées. Utilisez une adresse email personnelle ou professionnelle.',
        );
      }
    }
    this.validatePasswordStrength(password ?? '');

    const displayName = (fullName ?? name ?? '').trim();
    const finalName = displayName || normalized.split('@')[0] || normalized;

    const existing = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_USED',
        message: 'Cet e-mail est déjà utilisé.',
      });
    }

    try {
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await this.prisma.user.create({
        data: {
          email: normalized,
          name: finalName,
          balanceCents: 0,
          passwordHash,
          role: 'USER',
          mustChangePassword: false,
          emailVerified: false,
        },
        select: this.userSelect,
      });
      const token = this.signToken(user);
      return { token, user };
    } catch (e: any) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_USED',
          message: 'Cet e-mail est déjà utilisé.',
        });
      }
      throw e;
    }
  }

  async login(
    email: string,
    password: string,
    securityContext?: { ip?: string; deviceId?: string },
  ) {
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

    if ((user as any).isBanned) {
      throw new ForbiddenException({
        code: 'BANNED',
        message: (user as any).bannedReason ?? 'Compte suspendu.',
      });
    }
    if ((user as any).isActive === false) {
      throw new UnauthorizedException('Compte désactivé. Contactez le propriétaire de la marque.');
    }
    // Compte marque suspendu ou supprimé
    if (['BRAND', 'BRAND_OWNER', 'BRAND_STAFF'].includes(user.role) && user.brandId) {
      const brand = await this.prisma.brand.findUnique({
        where: { id: user.brandId },
        select: { status: true },
      });
      if (brand && brand.status !== 'ACTIVE') {
        throw new UnauthorizedException('Compte marque suspendu ou supprimé. Contactez l’administrateur.');
      }
    }

    const now = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: now,
        lastIp: securityContext?.ip ?? undefined,
        lastDeviceId: securityContext?.deviceId ?? undefined,
      },
    });

    let safeUser = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: this.userSelect,
    });
    if (!safeUser) {
      safeUser = this.toSafeUserFromFull(user) as NonNullable<typeof safeUser>;
    }

    const token = this.signToken({ id: user.id, email: user.email, role: user.role ?? 'USER' });
    return { token, user: safeUser };
  }

  /** Fallback si findUnique retourne null : construire l’objet user attendu par le client. */
  private toSafeUserFromFull(user: { id: number; email: string; name?: string | null; role: string; brandId?: number | null; agencyId?: number | null; mustChangePassword?: boolean | null; [k: string]: any }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name ?? '',
      balanceCents: Number((user as any).balanceCents) || 0,
      badgeLevel: ((user as any).badgeLevel ?? 'STARTER') as import('@prisma/client').UserBadge,
      dailyCapCents: Number((user as any).dailyCapCents) || 0,
      role: user.role ?? 'USER',
      brandId: user.brandId ?? null,
      agencyId: user.agencyId ?? null,
      mustChangePassword: user.mustChangePassword === true,
      isActive: (user as any).isActive !== false,
      emailVerified: Boolean((user as any).emailVerified),
      createdAt: ((user as any).createdAt instanceof Date ? (user as any).createdAt : new Date()) as Date,
      lastActiveAt: (user as any).lastActiveAt ?? null,
    };
  }

  // ✅ pour temp password : BRAND se connecte puis doit changer
  async changePassword(userId: number, newPassword: string, currentPassword?: string) {
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new BadRequestException('userId invalide');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');

    if (currentPassword != null && currentPassword !== '') {
      if (!user.passwordHash) throw new BadRequestException('Mot de passe actuel non défini');
      const ok = await bcrypt.compare(String(currentPassword), user.passwordHash);
      if (!ok) throw new UnauthorizedException('Mot de passe actuel incorrect');
    }

    const pwd = String(newPassword ?? '').trim();
    if (pwd.length < 8) throw new BadRequestException('Mot de passe trop court (min 8 caractères)');

    const hash = await bcrypt.hash(pwd, 10);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: hash,
        mustChangePassword: false,
        tempPasswordIssuedAt: null,
        tempPasswordExpiresAt: null,
      },
      select: this.userSelect,
    });

    return { success: true, message: 'Mot de passe mis à jour ✅', user: updated };
  }

  async getMe(userId: number) {
    if (!Number.isFinite(userId) || userId <= 0) throw new UnauthorizedException('Non authentifié');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: this.userSelect,
    });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');
    if ((user as any).isActive === false) throw new UnauthorizedException('Compte désactivé');
    return { user };
  }
}