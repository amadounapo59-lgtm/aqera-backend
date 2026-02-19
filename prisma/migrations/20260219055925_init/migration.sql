-- CreateEnum
CREATE TYPE "GiftCardPurchaseStatus" AS ENUM ('ACTIVE', 'USED', 'CANCELED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "BrandApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AgencyApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "UserBadge" AS ENUM ('STARTER', 'REGULAR', 'ELITE');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "tempPasswordIssuedAt" TIMESTAMP(3),
    "tempPasswordExpiresAt" TIMESTAMP(3),
    "pendingCents" INTEGER NOT NULL DEFAULT 0,
    "availableCents" INTEGER NOT NULL DEFAULT 0,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "badgeLevel" "UserBadge" NOT NULL DEFAULT 'STARTER',
    "dailyCapCents" INTEGER NOT NULL DEFAULT 1000,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "streakDays" INTEGER NOT NULL DEFAULT 0,
    "lastEarnedAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "brandId" INTEGER,
    "agencyId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agency" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "subscriptionStatus" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "plan" TEXT,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyBrand" (
    "id" SERIAL NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "brandId" INTEGER NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencyBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "website" TEXT,
    "coverUrl" TEXT,
    "subscriptionStatus" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "plan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CentralPool" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "totalDepositedCents" INTEGER NOT NULL DEFAULT 0,
    "reservedLiabilityCents" INTEGER NOT NULL DEFAULT 0,
    "totalSpentCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CentralPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandBudget" (
    "id" SERIAL NOT NULL,
    "brandId" INTEGER NOT NULL,
    "totalDepositedCents" INTEGER NOT NULL DEFAULT 0,
    "reservedForMissionsCents" INTEGER NOT NULL DEFAULT 0,
    "spentCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDailyEarning" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "dateKey" TEXT NOT NULL,
    "earnedCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDailyEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandApplication" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "country" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "category" TEXT,
    "notes" TEXT,
    "status" "BrandApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" INTEGER,
    "brandId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyApplication" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "agencyName" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "city" TEXT,
    "province" TEXT,
    "country" TEXT,
    "notes" TEXT,
    "status" "AgencyApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" INTEGER,
    "agencyId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionType" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "userRewardCents" INTEGER NOT NULL,
    "brandCostCents" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mission" (
    "id" SERIAL NOT NULL,
    "brandId" INTEGER NOT NULL,
    "missionTypeId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actionUrl" TEXT NOT NULL,
    "quantityTotal" INTEGER NOT NULL DEFAULT 0,
    "quantityRemaining" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionAttempt" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "missionId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" INTEGER,

    CONSTRAINT "MissionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "note" TEXT,
    "missionId" INTEGER,
    "attemptId" INTEGER,
    "giftCardId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCard" (
    "id" SERIAL NOT NULL,
    "brand" TEXT NOT NULL,
    "valueCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCardPurchase" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "giftCardId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "status" "GiftCardPurchaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "clientRequestId" TEXT,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" INTEGER,

    CONSTRAINT "GiftCardPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionCompletion" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "missionId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyMission" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rewardCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegacyMission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Agency_name_key" ON "Agency"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Agency_slug_key" ON "Agency"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Agency_email_key" ON "Agency"("email");

-- CreateIndex
CREATE INDEX "AgencyBrand_agencyId_idx" ON "AgencyBrand"("agencyId");

-- CreateIndex
CREATE INDEX "AgencyBrand_brandId_idx" ON "AgencyBrand"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyBrand_agencyId_brandId_key" ON "AgencyBrand"("agencyId", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "BrandBudget_brandId_key" ON "BrandBudget"("brandId");

-- CreateIndex
CREATE INDEX "BrandBudget_brandId_idx" ON "BrandBudget"("brandId");

-- CreateIndex
CREATE INDEX "UserDailyEarning_dateKey_idx" ON "UserDailyEarning"("dateKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserDailyEarning_userId_dateKey_key" ON "UserDailyEarning"("userId", "dateKey");

-- CreateIndex
CREATE INDEX "BrandApplication_status_createdAt_idx" ON "BrandApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BrandApplication_email_idx" ON "BrandApplication"("email");

-- CreateIndex
CREATE INDEX "AgencyApplication_status_createdAt_idx" ON "AgencyApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgencyApplication_email_idx" ON "AgencyApplication"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MissionType_code_key" ON "MissionType"("code");

-- CreateIndex
CREATE INDEX "Mission_brandId_createdAt_idx" ON "Mission"("brandId", "createdAt");

-- CreateIndex
CREATE INDEX "Mission_status_createdAt_idx" ON "Mission"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MissionAttempt_userId_createdAt_idx" ON "MissionAttempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MissionAttempt_missionId_createdAt_idx" ON "MissionAttempt"("missionId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_user_mission_status" ON "MissionAttempt"("userId", "missionId", "status");

-- CreateIndex
CREATE INDEX "WalletTransaction_userId_createdAt_idx" ON "WalletTransaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_brand_valueCents_key" ON "GiftCard"("brand", "valueCents");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardPurchase_code_key" ON "GiftCardPurchase"("code");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardPurchase_clientRequestId_key" ON "GiftCardPurchase"("clientRequestId");

-- CreateIndex
CREATE INDEX "GiftCardPurchase_userId_status_purchasedAt_idx" ON "GiftCardPurchase"("userId", "status", "purchasedAt");

-- CreateIndex
CREATE INDEX "GiftCardPurchase_giftCardId_purchasedAt_idx" ON "GiftCardPurchase"("giftCardId", "purchasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MissionCompletion_userId_missionId_key" ON "MissionCompletion"("userId", "missionId");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyMission_code_key" ON "LegacyMission"("code");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyBrand" ADD CONSTRAINT "AgencyBrand_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyBrand" ADD CONSTRAINT "AgencyBrand_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandBudget" ADD CONSTRAINT "BrandBudget_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDailyEarning" ADD CONSTRAINT "UserDailyEarning_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandApplication" ADD CONSTRAINT "BrandApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandApplication" ADD CONSTRAINT "BrandApplication_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyApplication" ADD CONSTRAINT "AgencyApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyApplication" ADD CONSTRAINT "AgencyApplication_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_missionTypeId_fkey" FOREIGN KEY ("missionTypeId") REFERENCES "MissionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionAttempt" ADD CONSTRAINT "MissionAttempt_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionAttempt" ADD CONSTRAINT "MissionAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionAttempt" ADD CONSTRAINT "MissionAttempt_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardPurchase" ADD CONSTRAINT "GiftCardPurchase_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardPurchase" ADD CONSTRAINT "GiftCardPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardPurchase" ADD CONSTRAINT "GiftCardPurchase_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionCompletion" ADD CONSTRAINT "MissionCompletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionCompletion" ADD CONSTRAINT "MissionCompletion_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "LegacyMission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
