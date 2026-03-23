// prisma/seed.ts
// Charge .env puis permet d’écraser avec `export DATABASE_URL=...` dans le terminal.
import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

/** Railway (proxy.rlwy.net) exige souvent TLS ; sinon PrismaClientInitializationError. */
function ensureSslForRailwayProxy(): void {
  const u = process.env.DATABASE_URL;
  if (!u || (!u.includes('rlwy.net') && !u.includes('railway.app'))) return;
  if (/[?&]sslmode=/.test(u)) return;
  const sep = u.includes('?') ? '&' : '?';
  process.env.DATABASE_URL = `${u}${sep}sslmode=require`;
  console.log('ℹ️  sslmode=require ajouté pour la connexion Railway.');
}

function logSafeDbHint(): void {
  const u = process.env.DATABASE_URL;
  if (!u) {
    console.error('❌ DATABASE_URL est vide. Définis-la (ex. export depuis Railway → Postgres).');
    return;
  }
  if (u.startsWith('file:')) {
    console.warn(
      '⚠️  DATABASE_URL = SQLite local. Pour seeder la prod, lance dans le même terminal :\n' +
        '   export DATABASE_URL="postgresql://..."   # URL publique Railway, puis relance le seed.',
    );
  } else {
    const masked = u.replace(/:([^:@]{0,})@/, ':****@');
    console.log('📍 Cible DB:', masked);
  }
}

ensureSslForRailwayProxy();
logSafeDbHint();

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
      emailVerified: true,
    },
    create: {
      email: adminEmail,
      name: 'Admin AQERA',
      role: 'ADMIN',
      passwordHash: adminHash,
      balanceCents: 0,
      emailVerified: true,
    },
  });

  console.log('✅ Admin ready:', admin.email);

  // ======================================================
  // CENTRAL POOL (singleton id=1)
  // ======================================================
  await prisma.centralPool.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      totalDepositedCents: 0,
      reservedLiabilityCents: 0,
      totalSpentCents: 0,
      platformRevenueCents: 0,
      platformMarginCents: 0,
      platformAvailableCents: 0,
      platformSpentCents: 0,
    },
  });
  console.log('✅ CentralPool ready');

  // ======================================================
  // MISSION TYPES — Barème fixe (userReward + 10c = brandCost)
  // LIKE 20/30, FOLLOW 50/60, COMMENT 80/90, STORY 150/160, POST 300/310
  // ======================================================
  const brandMissionTypes = [
    { code: 'LIKE', label: 'Like', userRewardCents: 20, brandCostCents: 30 },
    { code: 'FOLLOW', label: 'Abonnement', userRewardCents: 50, brandCostCents: 60 },
    { code: 'COMMENT', label: 'Commentaire', userRewardCents: 80, brandCostCents: 90 },
    { code: 'STORY', label: 'Story', userRewardCents: 150, brandCostCents: 160 },
    { code: 'POST', label: 'Post', userRewardCents: 300, brandCostCents: 310 },
  ];

  for (const mt of brandMissionTypes) {
    await prisma.missionType.upsert({
      where: { code: mt.code },
      update: { ...mt, isActive: true },
      create: { ...mt, isActive: true },
    });
  }

  // Types PLATFORM (campagnes AQERA): reward = brandCost, pas de marge
  const platformMissionTypes = [
    { code: 'FOLLOW_AQERA', label: 'Suivre AQERA', userRewardCents: 50, brandCostCents: 50 },
    { code: 'REFERRAL', label: 'Parrainage', userRewardCents: 100, brandCostCents: 100 },
    { code: 'REVIEW', label: 'Avis AQERA', userRewardCents: 80, brandCostCents: 80 },
    { code: 'STORY_AQERA', label: 'Story AQERA', userRewardCents: 150, brandCostCents: 150 },
  ];

  for (const mt of platformMissionTypes) {
    await prisma.missionType.upsert({
      where: { code: mt.code },
      update: { ...mt, isActive: true },
      create: { ...mt, isActive: true },
    });
  }

  console.log('✅ MissionTypes ready (brand + platform)');

  // ======================================================
  // BRAND AQERA (pour campagnes PLATFORM)
  // ======================================================
  const aqeraBrand = await prisma.brand.upsert({
    where: { slug: 'aqera' },
    update: {},
    create: {
      name: 'AQERA',
      slug: 'aqera',
      description: 'Campagnes plateforme AQERA',
    },
  });
  console.log('✅ Brand AQERA ready:', aqeraBrand.name);

  // ======================================================
  // BRAND (DEV / TEST ONLY)
  // ======================================================
  const brand = await prisma.brand.upsert({
    where: { slug: 'le-bloc-africain' },
    update: { status: 'ACTIVE', category: 'RESTAURANT' },
    create: {
      name: 'Le Bloc Africain',
      slug: 'le-bloc-africain',
      description: 'Restaurant africain premium',
      logoUrl: 'https://example.com/logo.png',
      coverUrl: 'https://example.com/cover.png',
      category: 'RESTAURANT',
      plan: 'STARTER',
      subscriptionStatus: 'ACTIVE',
      status: 'ACTIVE',
    },
  });

  console.log('✅ Brand ready:', brand.name);

  // ======================================================
  // BRAND BUDGET (DEV / TEST ONLY)
  // ======================================================
  await prisma.brandBudget.upsert({
    where: { brandId: brand.id },
    update: {},
    create: { brandId: brand.id, totalDepositedCents: 40000 }, // 400$ pour tests
  });
  console.log('✅ Brand budget ready');

  // ======================================================
  // BRAND USER (DEV / TEST ONLY)
  // ======================================================
  const brandPassword = 'Brand123!';
  const brandHash = await bcrypt.hash(brandPassword, 10);

  const brandUser = await prisma.user.upsert({
    where: { email: 'brand@blocafricain.com' },
    update: {
      brandId: brand.id,
      role: 'BRAND_OWNER',
      emailVerified: true,
    },
    create: {
      email: 'brand@blocafricain.com',
      name: 'Bloc Africain Manager',
      role: 'BRAND_OWNER',
      passwordHash: brandHash,
      brandId: brand.id,
      balanceCents: 0,
      emailVerified: true,
    },
  });

  console.log('✅ Brand owner ready:', brandUser.email);

  // Brand staff (Mode Caisse) — mustChangePassword=false for quick tests
  const staffPassword = 'Staff123!';
  const staffHash = await bcrypt.hash(staffPassword, 10);
  const staffUser = await prisma.user.upsert({
    where: { email: 'staff@blocafricain.com' },
    update: {
      brandId: brand.id,
      role: 'BRAND_STAFF',
      passwordHash: staffHash,
      mustChangePassword: false,
      isActive: true,
      emailVerified: true,
    },
    create: {
      email: 'staff@blocafricain.com',
      name: 'Employé Caisse',
      role: 'BRAND_STAFF',
      passwordHash: staffHash,
      brandId: brand.id,
      balanceCents: 0,
      mustChangePassword: false,
      isActive: true,
      emailVerified: true,
    },
  });
  console.log('✅ Brand staff ready:', staffUser.email);

  // ======================================================
  // GIFTCARDS (DEV / TEST ONLY) - ✅ upsert (no duplicates)
  // ======================================================
  // 10, 20, 30, 50 $ CAD (valueCents: 1000, 2000, 3000, 5000) — Option 1: stock géré par ADMIN
  const giftcards = [
    { brandId: brand.id, valueCents: 1000 },
    { brandId: brand.id, valueCents: 2000 },
    { brandId: brand.id, valueCents: 3000 },
    { brandId: brand.id, valueCents: 5000 },
  ];

  for (const g of giftcards) {
    await prisma.giftCard.upsert({
      where: {
        uniq_brand_value: {
          brandId: g.brandId,
          valueCents: g.valueCents,
        },
      },
      update: {},
      create: g,
    });
  }

  console.log('✅ GiftCards upserted (no duplicates)');

  // ======================================================
  // GIFTCARD INVENTORY (DEV / TEST ONLY) — 2–3 codes fake par valeur
  // ======================================================
  const ten = await prisma.giftCard.findFirst({ where: { brandId: brand.id, valueCents: 1000 } });
  if (ten) {
    const codes = ['BLOC-10-AAA1', 'BLOC-10-AAA2', 'BLOC-10-AAA3'];
    for (const code of codes) {
      await prisma.giftCardInventoryItem.upsert({
        where: { code },
        update: {},
        create: { giftCardId: ten.id, code },
      });
    }
  }
  const twenty = await prisma.giftCard.findFirst({ where: { brandId: brand.id, valueCents: 2000 } });
  if (twenty) {
    const codes = ['BLOC-20-BBB1', 'BLOC-20-BBB2'];
    for (const code of codes) {
      await prisma.giftCardInventoryItem.upsert({
        where: { code },
        update: {},
        create: { giftCardId: twenty.id, code },
      });
    }
  }
  const fifty = await prisma.giftCard.findFirst({ where: { brandId: brand.id, valueCents: 5000 } });
  if (fifty) {
    const codes = ['BLOC-50-CCC1', 'BLOC-50-CCC2', 'BLOC-50-CCC3'];
    for (const code of codes) {
      await prisma.giftCardInventoryItem.upsert({
        where: { code },
        update: {},
        create: { giftCardId: fifty.id, code },
      });
    }
  }
  console.log('✅ GiftCard inventory seeded');

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

  // ======================================================
  // DEMO ADMIN ALERTS (pilote)
  // ======================================================
  if (brandUser) {
    const existing = await prisma.adminAlert.findFirst({
      where: { type: 'USER_RISK_HIGH', userId: brandUser.id, status: 'OPEN' },
    });
    if (!existing) {
      await prisma.adminAlert.create({
        data: {
          type: 'USER_RISK_HIGH',
          severity: 'HIGH',
          message: 'User flagged high risk by scoring rules',
          userId: brandUser.id,
          metadataJson: { riskScore: 25, reasons: ['rejectRate_high'], rejects7d: 3, submits1h: 2, demo: true },
          status: 'OPEN',
        },
      });
      console.log('✅ Demo AdminAlert (USER_RISK_HIGH) created');
    }
  }
  // Optional: one RESOLVED alert for demo variety (no userId)
  const resolvedCount = await prisma.adminAlert.count({ where: { status: 'RESOLVED' } });
  if (resolvedCount === 0) {
    await prisma.adminAlert.create({
      data: {
        type: 'USER_RISK_HIGH',
        severity: 'MEDIUM',
        message: 'Demo resolved alert (seed)',
        userId: null,
        status: 'RESOLVED',
      },
    });
    console.log('✅ Demo AdminAlert (RESOLVED) created');
  }

  console.log('==============================');
  console.log('SEED FINISHED SUCCESSFULLY');
  console.log('Admin:', adminEmail);
  console.log('Admin Password:', adminPassword);
  console.log('Brand Owner: brand@blocafricain.com');
  console.log('Brand Password:', brandPassword);
  console.log('Brand Staff: staff@blocafricain.com');
  console.log('Staff Password:', staffPassword);
  console.log('==============================');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    const msg = String(e?.message ?? e);
    if (msg.includes('P1001') || msg.includes("Can't reach database")) {
      console.error('\n→ Réseau / hôte : vérifie l’URL, le port, et que la machine peut joindre le host (pas railway.internal depuis ton Mac).');
    }
    if (msg.includes('does not exist') && msg.includes('Database')) {
      console.error('\n→ Nom de base : l’URL doit se terminer par /railway (pas /railwayl, etc.).');
    }
    if (msg.includes('SSL') || msg.includes('certificate') || msg.includes('TLS')) {
      console.error('\n→ SSL : l’URL Railway publique doit accepter TLS (sslmode=require est ajouté automatiquement pour *.rlwy.net).');
    }
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });