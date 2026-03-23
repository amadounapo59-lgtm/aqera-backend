import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { assertDatasourceUrl, resolveDatabaseUrl } from './resolve-database-url';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const url = resolveDatabaseUrl();
    assertDatasourceUrl(url);
    if (!process.env.DATABASE_URL?.trim()) {
      process.env.DATABASE_URL = url;
    }
    super({
      datasources: {
        db: { url },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
