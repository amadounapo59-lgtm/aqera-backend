-- AlterTable User: add isActive for staff revocation
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT 1;
