-- AlterTable DailyMetrics: add KPI V2 columns
ALTER TABLE "DailyMetrics" ADD COLUMN "activationRate24h" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DailyMetrics" ADD COLUMN "retentionD1" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DailyMetrics" ADD COLUMN "retentionD7" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DailyMetrics" ADD COLUMN "avgTimeToFirstRewardHours" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DailyMetrics" ADD COLUMN "approvalRate" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DailyMetrics" ADD COLUMN "completionRate" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DailyMetrics" ADD COLUMN "avgMissionsPerActiveUser" REAL NOT NULL DEFAULT 0;

-- CreateTable UserScore
CREATE TABLE "UserScore" (
    "userId" INTEGER NOT NULL PRIMARY KEY,
    "trustScore" INTEGER NOT NULL DEFAULT 50,
    "riskLevel" TEXT NOT NULL DEFAULT 'MEDIUM',
    "rejects7d" INTEGER NOT NULL DEFAULT 0,
    "submits1h" INTEGER NOT NULL DEFAULT 0,
    "avgTimeToSubmitMs" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable MissionTypePerformance
CREATE TABLE "MissionTypePerformance" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "missionTypeCode" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "views7d" INTEGER NOT NULL DEFAULT 0,
    "submits7d" INTEGER NOT NULL DEFAULT 0,
    "approvals7d" INTEGER NOT NULL DEFAULT 0,
    "rejections7d" INTEGER NOT NULL DEFAULT 0,
    "completionRate7d" REAL NOT NULL DEFAULT 0,
    "approvalRate7d" REAL NOT NULL DEFAULT 0,
    "avgTimeToSubmitMs7d" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex MissionTypePerformance unique
CREATE UNIQUE INDEX "MissionTypePerformance_missionTypeCode_platform_key" ON "MissionTypePerformance"("missionTypeCode", "platform");
