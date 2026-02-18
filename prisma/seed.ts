// prisma/seed.ts

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ======================================================
  // ADMIN
  // ======================================================
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@aqera.app').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';
  const adminHash = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      role: 'ADMIN',
      passwordHash: adminHash,
      name: 'Admin AQERA',
    },
    create: {
      email: adminEmail,
      name: 'Admin AQERA',
      role: 'ADMIN',
      passwordHash: adminHash,
      balanceCents: 0,
    },
  });

  console.log('✅ Admin ready:', admin.email);

  // ======================================================
  // MISSION TYPES
  // ======================================================
  const missionTypes = [
    { code: 'FOLLOW', label: 'Abonnement', userRewardCents: 50, brandCostCents: 75 },
    { code: 'LIKE', label: 'Like', userRewardCents: 25, brandCostCents: 40 },
    { code: 'COMMENT', label: 'Commentaire', userRewardCents: 100, brandCostCents: 140 },
    { code: 'STORY', label: 'Story', userRewardCents: 200, brandCostCents: 280 },
  ];

  for (const mt of missionTypes) {
    await prisma.missionType.upsert({
      where: { code: mt.code },
      update: { ...mt, isActive: true },
      create: { ...mt, isActive: true },
    });
  }

  console.log('✅ MissionTypes ready');

  // ======================================================
  // BRAND (DEV / TEST ONLY)
  // ======================================================
  const brand = await prisma.brand.upsert({
    where: { slug: 'le-bloc-africain' },
    update: {},
    create: {
      name: 'Le Bloc Africain',
      slug: 'le-bloc-africain',
      description: 'Restaurant africain premium',
      logoUrl: 'https://example.com/logo.png',
      coverUrl: 'https://example.com/cover.png',
      plan: 'STARTER',
      subscriptionStatus: 'ACTIVE',
    },
  });

  console.log('✅ Brand ready:', brand.name);

  // ======================================================
  // BRAND USER (DEV / TEST ONLY)
  // ======================================================
  const brandPassword = 'Brand123!';
  const brandHash = await bcrypt.hash(brandPassword, 10);

  const brandUser = await prisma.user.upsert({
    where: { email: 'brand@blocafricain.com' },
    update: {
      brandId: brand.id,
      role: 'BRAND',
    },
    create: {
      email: 'brand@blocafricain.com',
      name: 'Bloc Africain Manager',
      role: 'BRAND',
      passwordHash: brandHash,
      brandId: brand.id,
      balanceCents: 0,
    },
  });

  console.log('✅ Brand user ready:', brandUser.email);

  // ======================================================
  // GIFTCARDS (DEV / TEST ONLY) - ✅ upsert (no duplicates)
  // ======================================================
  const giftcards = [
    { brand: brand.name, valueCents: 1000 },
    { brand: brand.name, valueCents: 2000 },
    { brand: brand.name, valueCents: 3000 },
  ];

  for (const g of giftcards) {
    await prisma.giftCard.upsert({
      where: {
        uniq_brand_value: {
          brand: g.brand,
          valueCents: g.valueCents,
        },
      },
      update: {},
      create: g,
    });
  }

  console.log('✅ GiftCards upserted (no duplicates)');

  // ======================================================
  // 1 MISSION ACTIVE (DEV / TEST ONLY)
  // ======================================================
  const followType = await prisma.missionType.findUnique({ where: { code: 'FOLLOW' } });
  if (!followType) throw new Error('MissionType FOLLOW introuvable');

  // On utilise un "code" stable via title/actionUrl (pas de champ code dans Mission)
  // => on upsert via une recherche findFirst + update/create
  const missionTitle = 'Suis Le Bloc Africain sur Instagram';
  const missionActionUrl = 'https://www.instagram.com/leblocafricain/';

  const existingMission = await prisma.mission.findFirst({
    where: {
      brandId: brand.id,
      title: missionTitle,
      actionUrl: missionActionUrl,
    },
  });

  if (existingMission) {
    await prisma.mission.update({
      where: { id: existingMission.id },
      data: {
        missionTypeId: followType.id,
        description: 'Abonne-toi sur Instagram, puis reviens et clique “J’ai terminé”.',
        status: 'ACTIVE',
        quantityTotal: 100,
        quantityRemaining: 100,
      },
    });
    console.log('✅ Mission ACTIVE updated');
  } else {
    await prisma.mission.create({
      data: {
        brandId: brand.id,
        missionTypeId: followType.id,
        title: missionTitle,
        description: 'Abonne-toi sur Instagram, puis reviens et clique “J’ai terminé”.',
        actionUrl: missionActionUrl,
        quantityTotal: 100,
        quantityRemaining: 100,
        status: 'ACTIVE',
      },
    });
    console.log('✅ Mission ACTIVE created');
  }

  console.log('==============================');
  console.log('SEED FINISHED SUCCESSFULLY');
  console.log('Admin:', adminEmail);
  console.log('Admin Password:', adminPassword);
  console.log('Brand User: brand@blocafricain.com');
  console.log('Brand Password:', brandPassword);
  console.log('==============================');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });