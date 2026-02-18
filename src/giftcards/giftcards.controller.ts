import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { GiftcardsService } from './giftcards.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@Controller('giftcards')
export class GiftcardsController {
  constructor(private readonly giftcardsService: GiftcardsService) {}

  // USER — list giftcards
  @Get()
  getAll() {
    return this.giftcardsService.findAll();
  }

  // USER — purchase (with idempotency)
  @UseGuards(JwtAuthGuard)
  @Post('purchase')
  purchase(
    @Req() req: any,
    @Body('giftCardId') giftCardId: number,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ) {
    return this.giftcardsService.purchaseByUserId(
      req.user.id,
      Number(giftCardId),
      idempotencyKey,
    );
  }

  // USER — my purchases
  @UseGuards(JwtAuthGuard)
  @Get('my-purchases')
  myPurchases(@Req() req: any, @Query('status') status?: string) {
    return this.giftcardsService.getMyPurchases(req.user.id, status);
  }

  // BRAND — redeem by purchase id
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND')
  @Post('purchases/:id/use')
  usePurchase(@Req() req: any, @Param('id') id: string) {
    return this.giftcardsService.usePurchase(Number(id), req.user.id);
  }

  // BRAND — redeem by code
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('BRAND')
  @Post('redeem')
  redeemByCode(@Req() req: any, @Body('code') code: string) {
    return this.giftcardsService.redeemByCode(code, req.user.id);
  }
}