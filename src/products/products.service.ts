import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // Liste tous les produits
  async findAll() {
    return this.prisma.product.findMany();
  }

  // Récupère un produit par son code (p1, p2…)
  async findOne(code: string) {
    return this.prisma.product.findUnique({
      where: { code },
    });
  }

  // Crée un nouveau produit
  async create(data: {
    code: string;
    name: string;
    description: string;
    priceCents: number;
  }) {
    return this.prisma.product.create({
      data,
    });
  }

  // Achète un produit et débite le wallet
  async buyProduct(productId: string, quantity: number) {
    // 1) Récupérer le produit (avec son code p1, p2…)
    const product = await this.findOne(productId);

    if (!product) {
      throw new Error('Produit introuvable');
    }

    const totalPriceCents = product.priceCents * quantity;

    // 2) Récupérer l’utilisateur
    const user = await this.prisma.user.findUnique({
      where: { email: 'demo@adcash.local' },
    });

    if (!user) {
      throw new Error('Utilisateur introuvable');
    }

    // 3) Vérifier le solde
    if (user.balanceCents < totalPriceCents) {
      throw new Error('Solde insuffisant');
    }

    // 4) Mettre à jour le wallet
    const updated = await this.prisma.user.update({
      where: { email: 'demo@adcash.local' },
      data: {
        balanceCents: user.balanceCents - totalPriceCents,
      },
    });

    // 5) Réponse
    return {
      message: 'Achat réussi',
      product: {
        id: product.id,
        code: product.code,
        name: product.name,
        priceCents: product.priceCents,
      },
      quantity,
      totalPriceCents,
      wallet: {
        balanceCents: updated.balanceCents,
        balance: updated.balanceCents / 100,
      },
    };
  }
}
