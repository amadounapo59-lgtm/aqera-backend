import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BrandApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeEmail(email: string) {
    return (email ?? '').trim().toLowerCase();
  }

  // POST /brand-applications
  async createApplication(dto: {
    email: string;
    businessName: string;
    phone?: string;
    address?: string;
    city?: string;
    province?: string;
    country?: string;
    website?: string;
    instagram?: string;
    category?: string;
  }) {
    const email = this.normalizeEmail(dto.email);
    if (!email) throw new BadRequestException('Email obligatoire');

    const businessName = (dto.businessName ?? '').trim();
    if (!businessName) throw new BadRequestException("Nom de l'établissement obligatoire");

    // (optionnel) éviter spam: une demande PENDING existante pour le même email
    const existingPending = await this.prisma.brandApplication.findFirst({
      where: { email, status: 'PENDING' as any },
    });
    if (existingPending) {
      return {
        success: true,
        message: 'Demande déjà envoyée ⏳',
        application: existingPending,
      };
    }

    const app = await this.prisma.brandApplication.create({
      data: {
        // ✅ Champ correct selon le schema : email (et non businessEmail)
        email,
        businessName,

        phone: dto.phone?.trim() || undefined,
        address: dto.address?.trim() || undefined,
        city: dto.city?.trim() || undefined,
        province: dto.province?.trim() || undefined,
        country: dto.country?.trim() || undefined,
        website: dto.website?.trim() || undefined,
        instagram: dto.instagram?.trim() || undefined,
        category: dto.category?.trim() || undefined,

        status: 'PENDING' as any,
      },
    });

    return { success: true, message: 'Demande envoyée ✅', application: app };
  }
}