-- CreateTable Campaign (mixed mission types, one budget)
CREATE TABLE "Campaign" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "brandId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "platforms" TEXT,
    "totalBudgetCents" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Campaign_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Campaign_brandId_createdAt_idx" ON "Campaign"("brandId", "createdAt");

-- AlterTable Mission: add campaignId (nullable for backward compatibility)
ALTER TABLE "Mission" ADD COLUMN "campaignId" INTEGER;
CREATE INDEX "Mission_campaignId_idx" ON "Mission"("campaignId");
-- SQLite does not support ADD CONSTRAINT for existing tables; Prisma handles the FK via relation.
