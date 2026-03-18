-- AlterTable User: add isBlocked (admin manual block)
ALTER TABLE "User" ADD COLUMN "isBlocked" BOOLEAN NOT NULL DEFAULT 0;

-- CreateTable AdminAlert
CREATE TABLE "AdminAlert" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "userId" INTEGER,
    "metadataJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AdminAlert_status_createdAt_idx" ON "AdminAlert"("status", "createdAt");
CREATE INDEX "AdminAlert_type_userId_idx" ON "AdminAlert"("type", "userId");
CREATE INDEX "AdminAlert_status_idx" ON "AdminAlert"("status");
