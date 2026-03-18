-- CreateTable
CREATE TABLE "EventLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER,
    "role" TEXT,
    "eventName" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" INTEGER,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyMetrics" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dateKey" TEXT NOT NULL,
    "dau" INTEGER NOT NULL DEFAULT 0,
    "newUsers" INTEGER NOT NULL DEFAULT 0,
    "missionSubmits" INTEGER NOT NULL DEFAULT 0,
    "missionApprovals" INTEGER NOT NULL DEFAULT 0,
    "missionRejections" INTEGER NOT NULL DEFAULT 0,
    "giftcardPurchases" INTEGER NOT NULL DEFAULT 0,
    "marginEarnedCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "EventLog_eventName_createdAt_idx" ON "EventLog"("eventName", "createdAt");

-- CreateIndex
CREATE INDEX "EventLog_userId_createdAt_idx" ON "EventLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EventLog_entityType_entityId_createdAt_idx" ON "EventLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMetrics_dateKey_key" ON "DailyMetrics"("dateKey");
