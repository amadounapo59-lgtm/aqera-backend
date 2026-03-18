-- CreateTable
CREATE TABLE "BrandSettings" (
    "brandId" INTEGER NOT NULL,
    "avgOrderValueCents" INTEGER NOT NULL DEFAULT 0,
    "defaultVisitRateBps" INTEGER NOT NULL DEFAULT 800,
    "defaultLeadRateBps" INTEGER NOT NULL DEFAULT 200,
    "defaultPurchaseRateBps" INTEGER NOT NULL DEFAULT 150,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("brandId"),
    CONSTRAINT "BrandSettings_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
