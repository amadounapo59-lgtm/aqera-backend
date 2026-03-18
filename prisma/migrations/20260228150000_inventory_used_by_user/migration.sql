-- AlterTable GiftCardInventoryItem: add usedByUserId for redeem audit
ALTER TABLE "GiftCardInventoryItem" ADD COLUMN "usedByUserId" INTEGER;

CREATE INDEX "GiftCardInventoryItem_usedByUserId_idx" ON "GiftCardInventoryItem"("usedByUserId");
