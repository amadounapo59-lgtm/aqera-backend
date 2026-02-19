import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Stripe webhook raw body (OK)
  app.use('/billing/webhook', express.raw({ type: 'application/json' }));

  app.enableCors({
    origin: true,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'Stripe-Signature',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.PORT ?? 3000);

  // ✅ IMPORTANT pour Railway
  await app.listen(port, '0.0.0.0');

  console.log(`✅ API listening on 0.0.0.0:${port}`);
}
bootstrap();