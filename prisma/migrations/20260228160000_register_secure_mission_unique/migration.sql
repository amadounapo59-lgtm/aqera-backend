-- User: email verification scaffold
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT 0;

-- MissionAttempt: one attempt per user per mission (prevent double completion)
CREATE UNIQUE INDEX "MissionAttempt_userId_missionId_key" ON "MissionAttempt"("userId", "missionId");
