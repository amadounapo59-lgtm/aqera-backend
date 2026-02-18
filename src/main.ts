import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ✅ Stripe webhook: needs raw body for signature verification
  // Must be registered BEFORE body parsing for this route.
  app.use('/billing/webhook', express.raw({ type: 'application/json' }));

  // ✅ CORS (OK pour local + Railway)
  app.enableCors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'Stripe-Signature'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ✅ Global error filter (plus jamais "Internal server error" brut côté app)
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  // eslint-disable-next-line no-console
  console.log(`✅ API listening on http://localhost:${port}`);
}
bootstrap();