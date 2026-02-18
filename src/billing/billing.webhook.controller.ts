import { Controller, Headers, Post, Req } from '@nestjs/common';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingWebhookController {
  constructor(private readonly billing: BillingService) {}

  // Stripe will POST raw ...
  @Post('webhook')
  async handleWebhook(@Req() req: any, @Headers('stripe-signature') signature: string) {
    const buf = req.body; // express.raw => Buffer
    await this.billing.handleWebhook(buf, signature);
    return { received: true };
  }
}
