import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import * as express from 'express';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ✅ Static files: uploaded logos (brand dashboard)
  const uploadsDir = path.join(process.cwd(), 'uploads');
  app.use('/uploads', express.static(uploadsDir));

  // ✅ Stripe webhook: needs raw body for signature verification
  // Must be registered BEFORE body parsing for this route.
  app.use('/billing/webhook', express.raw({ type: 'application/json' }));

  // ✅ CORS (OK pour local + Railway + web dashboard)
  app.enableCors({
    origin: true,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'Stripe-Signature',
      'x-aqera-source',
      'x-device-id',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ✅ Global error filter (plus jamais "Internal server error" brut côté app)
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  // eslint-disable-next-line no-console
  console.log(`✅ API listening on http://0.0.0.0:${port}`);
}
bootstrap();