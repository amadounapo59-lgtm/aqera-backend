-- AlterTable CentralPool: add platform budget fields
ALTER TABLE "CentralPool" ADD COLUMN "platformMarginCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CentralPool" ADD COLUMN "platformAvailableCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CentralPool" ADD COLUMN "platformSpentCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable Mission: add platform (INSTAGRAM | FACEBOOK | TIKTOK)
ALTER TABLE "Mission" ADD COLUMN "platform" TEXT;
