-- CreateTable
CREATE TABLE "AiAuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER,
    "brandId" INTEGER,
    "type" TEXT NOT NULL,
    "inputJson" TEXT,
    "outputJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AiAuditLog_type_createdAt_idx" ON "AiAuditLog"("type", "createdAt");
CREATE INDEX "AiAuditLog_userId_createdAt_idx" ON "AiAuditLog"("userId", "createdAt");
CREATE INDEX "AiAuditLog_brandId_createdAt_idx" ON "AiAuditLog"("brandId", "createdAt");
