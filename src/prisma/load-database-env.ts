/**
 * Side-effect module: MUST be imported first from main.ts (before AppModule).
 * ES modules evaluate imports before main.ts body runs, so AppModule → PrismaClient
 * would load before any code in main.ts — Prisma then validates DATABASE_URL too early.
 */
import {
  logDatabaseEnvKeyPresence,
  resolveDatabaseUrl,
} from './resolve-database-url';

function isLikelyRailwayOrProductionDeploy(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    !!process.env.RAILWAY_ENVIRONMENT ||
    !!process.env.RAILWAY_PROJECT_ID ||
    !!process.env.RAILWAY_SERVICE_ID
  );
}

logDatabaseEnvKeyPresence();
const dbUrl = resolveDatabaseUrl();
if (dbUrl) {
  process.env.DATABASE_URL = dbUrl;
  // eslint-disable-next-line no-console
  console.error(
    `[AQERA] DATABASE_URL set for Prisma (ok, length=${dbUrl.length})`,
  );
} else if (isLikelyRailwayOrProductionDeploy()) {
  // eslint-disable-next-line no-console
  console.error(
    '[AQERA] FATAL: Aucune URL Postgres trouvée dans les variables d’environnement.',
  );
  // eslint-disable-next-line no-console
  console.error(
    'Sur Railway : service Postgres → Connect → copier DATABASE_URL dans Variables du service API, ou "Add variable" → Reference → Postgres.DATABASE_URL.',
  );
  process.exit(1);
}
