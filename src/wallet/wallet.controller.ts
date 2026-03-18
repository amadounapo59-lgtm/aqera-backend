import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  // ✅ USER
  @UseGuards(JwtAuthGuard)
  @Get('balance')
  balance(@Req() req: any) {
    return this.walletService.getBalanceByUserId(req.user.id);
  }

  // ✅ USER
  @UseGuards(JwtAuthGuard)
  @Get('transactions')
  transactions(@Req() req: any) {
    return this.walletService.getTransactionsByUserId(req.user.id);
  }

  // ✅ ADMIN ONLY (manual credit)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('add')
  add(
    @Body('userId') userId: number,
    @Body('amountCents') amountCents: number,
    @Body('note') note?: string,
  ) {
    return this.walletService.creditByUserId(
      Number(userId),
      Number(amountCents),
      note ?? 'Manual credit',
    );
  }

  // ✅ ADMIN ONLY (manual debit)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('spend')
  spend(
    @Body('userId') userId: number,
    @Body('amountCents') amountCents: number,
    @Body('note') note?: string,
    @Body('giftCardId') giftCardId?: number,
  ) {
    return this.walletService.debitByUserId(
      Number(userId),
      Number(amountCents),
      note ?? 'Manual debit',
      giftCardId ? Number(giftCardId) : undefined,
    );
  }
}