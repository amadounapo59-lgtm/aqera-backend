import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AgencyApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeEmail(email: string) {
    return (email ?? '').trim().toLowerCase();
  }

  async create(body: any) {
    const email = this.normalizeEmail(body?.email);
    const agencyName = (body?.agencyName ?? '').toString().trim();

    if (!email) throw new BadRequestException('Email obligatoire');
    if (!agencyName) throw new BadRequestException("Nom d'agence obligatoire");

    // Anti-spam simple: un email ne peut pas avoir plusieurs demandes PENDING
    const existing = await this.prisma.agencyApplication.findFirst({
      where: { email, status: 'PENDING' },
      select: { id: true },
    });
    if (existing) {
      return { success: true, message: 'Demande déjà reçue ✅', requestId: existing.id };
    }

    const app = await this.prisma.agencyApplication.create({
      data: {
        email,
        agencyName,
        contactName: body?.contactName ? String(body.contactName).trim() : undefined,
        phone: body?.phone ? String(body.phone).trim() : undefined,
        website: body?.website ? String(body.website).trim() : undefined,
        instagram: body?.instagram ? String(body.instagram).trim() : undefined,
        city: body?.city ? String(body.city).trim() : undefined,
        province: body?.province ? String(body.province).trim() : undefined,
        country: body?.country ? String(body.country).trim() : undefined,
        notes: body?.description ? String(body.description).trim() : undefined,
      },
      select: { id: true },
    });

    return { success: true, message: 'Demande envoyée ✅', requestId: app.id };
  }
}
