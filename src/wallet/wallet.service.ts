// src/wallet/wallet.service.ts

import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  // Badge caps (cents)
  private readonly CAP_STARTER = 1000; // $10/day
  private readonly CAP_REGULAR = 2000; // $20/day
  private readonly CAP_ELITE = 5000; // $50/day

  private normalizeEmail(email: string) {
    return (email ?? '').trim().toLowerCase();
  }

  // ---------- USERS ----------
  async getUserByEmail(email: string) {
    const normalized = this.normalizeEmail(email);
    if (!normalized) throw new BadRequestException('Email manquant');

    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');
    return user;
  }

  async getUserById(userId: number) {
    if (!Number.isFinite(userId) || userId <= 0) throw new BadRequestException('userId invalide');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');
    return user;
  }

  // ---------- BALANCE / TX ----------
  async getBalanceByUserId(userId: number) {
    const user = await this.getUserById(userId);
    // Backward-compatible: API keeps returning balanceCents
    // We treat "availableCents" as the real spendable balance.
    return { balanceCents: (user as any).availableCents ?? user.balanceCents };
  }

  async getBalance(email: string) {
    const user = await this.getUserByEmail(email);
    return { balanceCents: (user as any).availableCents ?? user.balanceCents };
  }

  async getTransactionsByUserId(userId: number) {
    await this.getUserById(userId);
    const txs = await this.prisma.walletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { transactions: txs };
  }

  async getTransactions(email: string) {
    const user = await this.getUserByEmail(email);
    return this.getTransactionsByUserId(user.id);
  }

  // ---------- CREDIT ----------
  async credit(email: string, amountCents: number, note = 'Credit', missionId?: number, attemptId?: number) {
    const user = await this.getUserByEmail(email);
    return this.creditByUserId(user.id, amountCents, note, missionId, attemptId);
  }

  // ✅ Standalone (ouvre sa transaction)
  async creditByUserId(
    userId: number,
    amountCents: number,
    note = 'Credit',
    missionId?: number,
    attemptId?: number,
  ) {
    this.assertAmount(userId, amountCents);
    const amt = Math.floor(amountCents);

    return this.prisma.$transaction(
      async (tx) => this.creditByUserIdTx(tx, userId, amt, note, missionId, attemptId),
      { timeout: 20000 }, // ✅ plus safe en dev
    );
  }

  // ✅ Utilisable DANS une transaction existante (pas de transaction imbriquée)
  async creditByUserIdTx(
    tx: TxClient,
    userId: number,
    amountCents: number,
    note = 'Credit',
    missionId?: number,
    attemptId?: number,
  ) {
    this.assertAmount(userId, amountCents);
    const amt = Math.floor(amountCents);

    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        // New economy
        availableCents: { increment: amt },
        // Legacy field used by existing mobile/web screens
        balanceCents: { increment: amt },
      },
    });

    await tx.walletTransaction.create({
      data: {
        userId,
        type: 'CREDIT',
        amountCents: amt,
        note,
        missionId: missionId ? Number(missionId) : undefined,
        attemptId: attemptId ? Number(attemptId) : undefined,
      },
    });

    // Update daily earning + badge (auto-upgrade)
    await this.bumpDailyEarningAndBadgeTx(tx, userId, amt);

    return { balanceCents: updatedUser.balanceCents };
  }

  // ---------- DEBIT ----------
  async debit(email: string, amountCents: number, note = 'Debit', giftCardId?: number) {
    const normalized = this.normalizeEmail(email);
    if (!normalized) throw new BadRequestException('Email manquant');
    if (!Number.isFinite(amountCents) || amountCents <= 0) throw new BadRequestException('amountCents invalide');

    const amt = Math.floor(amountCents);

    return this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({ where: { email: normalized } });
        if (!user) throw new BadRequestException('Utilisateur introuvable');
        return this.debitByUserIdTx(tx, user.id, amt, note, giftCardId);
      },
      { timeout: 20000 },
    );
  }

  async debitByUserId(userId: number, amountCents: number, note = 'Debit', giftCardId?: number) {
    this.assertAmount(userId, amountCents);
    const amt = Math.floor(amountCents);

    return this.prisma.$transaction(
      async (tx) => this.debitByUserIdTx(tx, userId, amt, note, giftCardId),
      { timeout: 20000 },
    );
  }

  async debitByUserIdTx(tx: TxClient, userId: number, amountCents: number, note = 'Debit', giftCardId?: number) {
    this.assertAmount(userId, amountCents);
    const amt = Math.floor(amountCents);

    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    const available = (user as any).availableCents ?? user.balanceCents;
    if (available < amt) throw new BadRequestException('Solde insuffisant');

    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        availableCents: { decrement: amt },
        balanceCents: { decrement: amt },
      },
    });

    await tx.walletTransaction.create({
      data: {
        userId,
        type: 'DEBIT',
        amountCents: amt,
        note,
        giftCardId: giftCardId ? Number(giftCardId) : undefined,
      },
    });

    return { balanceCents: updatedUser.balanceCents };
  }

  // ---------- PENDING (Pocket B) ----------

  /**
   * Reserve a reward as "pending" for a mission attempt (not spendable yet).
   * This does NOT change balanceCents/availableCents.
   */
  async addPendingTx(
    tx: TxClient,
    userId: number,
    amountCents: number,
    note = 'Pending reward',
    missionId?: number,
    attemptId?: number,
  ) {
    this.assertAmount(userId, amountCents);
    const amt = Math.floor(amountCents);

    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    await tx.user.update({
      where: { id: userId },
      data: { pendingCents: { increment: amt } },
    });

    await tx.walletTransaction.create({
      data: {
        userId,
        type: 'PENDING',
        amountCents: amt,
        note,
        missionId: missionId ? Number(missionId) : undefined,
        attemptId: attemptId ? Number(attemptId) : undefined,
      },
    });

    return { pendingCentsAdded: amt };
  }

  /**
   * Unlock pending reward into spendable balance.
   */
  async unlockPendingTx(
    tx: TxClient,
    userId: number,
    amountCents: number,
    note = 'Unlock reward',
    missionId?: number,
    attemptId?: number,
  ) {
    this.assertAmount(userId, amountCents);
    const amt = Math.floor(amountCents);

    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    // Enforce daily cap (badge-based) at the moment rewards are unlocked.
    // This prevents pending submissions from being approved beyond the user's limit.
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const dateKey = `${y}-${m}-${d}`;

    const cap = (user as any).dailyCapCents ?? this.CAP_STARTER;
    const earnedRow = await tx.userDailyEarning.findUnique({
      // @@unique([userId, dateKey], name: "uniq_user_day")
      where: { uniq_user_day: { userId, dateKey } },
    });
    const earned = earnedRow?.earnedCents ?? 0;

    if (earned >= cap || earned + amt > cap) {
      const remaining = Math.max(0, cap - earned);
      throw new BadRequestException(
        remaining <= 0
          ? 'Plafond journalier atteint. Reviens demain pour de nouvelles missions.'
          : `Plafond journalier presque atteint. Il te reste ${(remaining / 100).toFixed(2)}$ aujourd'hui.`,
      );
    }

    const pending = (user as any).pendingCents ?? 0;
    if (pending < amt) throw new BadRequestException('Pending insuffisant');

    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        pendingCents: { decrement: amt },
        availableCents: { increment: amt },
        balanceCents: { increment: amt }, // legacy
      },
    });

    await tx.walletTransaction.create({
      data: {
        userId,
        type: 'CREDIT',
        amountCents: amt,
        note,
        missionId: missionId ? Number(missionId) : undefined,
        attemptId: attemptId ? Number(attemptId) : undefined,
      },
    });

    await this.bumpDailyEarningAndBadgeTx(tx, userId, amt);

    return {
      balanceCents: updatedUser.balanceCents,
      availableCents: (updatedUser as any).availableCents,
      pendingCents: (updatedUser as any).pendingCents,
    };
  }

  // ---------- Badge / daily cap ----------

  private async bumpDailyEarningAndBadgeTx(tx: TxClient, userId: number, creditCents: number) {
    // dateKey in local time (YYYY-MM-DD)
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const dateKey = `${y}-${m}-${d}`;

    await tx.userDailyEarning.upsert({
      // @@unique([userId, dateKey], name: "uniq_user_day")
      where: { uniq_user_day: { userId, dateKey } },
      create: { userId, dateKey, earnedCents: creditCents },
      update: { earnedCents: { increment: creditCents } },
    });

    // Compute streak on last 40 days of earnings
    const days = await tx.userDailyEarning.findMany({
      where: { userId },
      orderBy: { dateKey: 'desc' },
      take: 40,
    });

    const streak = this.computeStreak(days.map((x) => x.dateKey));

    const nextBadge = streak >= 30 ? 'ELITE' : streak >= 7 ? 'REGULAR' : 'STARTER';
    const nextCap = nextBadge === 'ELITE' ? this.CAP_ELITE : nextBadge === 'REGULAR' ? this.CAP_REGULAR : this.CAP_STARTER;

    await tx.user.update({
      where: { id: userId },
      data: {
        // stored as badgeLevel in DB, UI can expose label only
        badgeLevel: nextBadge as any,
        dailyCapCents: nextCap,
        streakDays: streak,
        // xp increments silently (not shown in UI)
        xp: { increment: Math.max(1, Math.floor(creditCents / 100)) },
        lastActiveAt: new Date(),
      },
    });
  }

  // Backward-compat alias (older services used this name)
  async unlockPendingToAvailableTx(tx: TxClient, userId: number, creditCents: number, note = 'Mission reward', missionId?: number, attemptId?: number) {
    return this.unlockPendingTx(tx, userId, creditCents, note, missionId, attemptId);
  }

  private computeStreak(dateKeysDesc: string[]) {
    // dateKeysDesc: newest -> oldest
    if (!dateKeysDesc.length) return 0;
    const set = new Set(dateKeysDesc);

    let streak = 0;
    const now = new Date();
    // Start from today, count consecutive days backwards with activity
    for (let i = 0; i < 60; i++) {
      const dt = new Date(now);
      dt.setDate(now.getDate() - i);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${d}`;
      if (set.has(key)) streak++;
      else break;
    }
    return streak;
  }

  private assertAmount(userId: number, amountCents: number) {
    if (!Number.isFinite(userId) || userId <= 0) throw new BadRequestException('userId invalide');
    if (!Number.isFinite(amountCents) || amountCents <= 0) throw new BadRequestException('amountCents invalide');
  }
}