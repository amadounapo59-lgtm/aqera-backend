#!/bin/sh
set -e
echo "=== AQERA backend: docker-entrypoint starting ==="

# Normalize DB env for Prisma on Railway-like environments.
# Priority:
# 1) DATABASE_URL (already set)
# 2) POSTGRES_URL / POSTGRESQL_URL / DATABASE_PRIVATE_URL
# 3) PG* variables (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE)
if [ -z "${DATABASE_URL}" ]; then
  if [ -n "${POSTGRES_URL}" ]; then
    export DATABASE_URL="${POSTGRES_URL}"
  elif [ -n "${POSTGRESQL_URL}" ]; then
    export DATABASE_URL="${POSTGRESQL_URL}"
  elif [ -n "${DATABASE_PRIVATE_URL}" ]; then
    export DATABASE_URL="${DATABASE_PRIVATE_URL}"
  elif [ -n "${PGHOST}" ] && [ -n "${PGUSER}" ] && [ -n "${PGPASSWORD}" ] && [ -n "${PGDATABASE}" ]; then
    PG_PORT="${PGPORT:-5432}"
    export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PG_PORT}/${PGDATABASE}"
  fi
fi

# Fail fast with a visible log line (Railway "Deploy" can be green while runtime crashes)
if [ -z "$DATABASE_URL" ]; then
  echo "FATAL: DATABASE_URL is empty. Railway did not inject it (or fallbacks missing)."
  echo "Fix: add DATABASE_URL on this service, or set POSTGRES_URL / DATABASE_PRIVATE_URL, or PGHOST+PGUSER+PGPASSWORD+PGDATABASE."
  exit 1
fi
if ! echo "$DATABASE_URL" | grep -qiE '^(postgres|postgresql)://'; then
  echo "FATAL: DATABASE_URL must start with postgresql:// or postgres:// (Prisma PostgreSQL)."
  exit 1
fi

echo "DATABASE_URL is set (host hidden). Running Prisma..."

# With PostgreSQL: regenerate client + apply migrations (handles stale Railway image cache)
echo "Generating Prisma client (schema.prod.prisma)..."
npx prisma generate --schema=prisma/schema.prod.prisma
echo "Applying Prisma migrations (schema.prod.prisma)..."
npx prisma migrate deploy --schema=prisma/schema.prod.prisma

# Optional: set RUN_SEED=1 to run prisma/seed.ts (uses ts-node from dependencies).
if [ "${RUN_SEED}" = "1" ]; then
  echo "Running Prisma seed (schema.prod.prisma)..."
  npx prisma db seed --schema=prisma/schema.prod.prisma
fi

echo "=== Starting application: $* ==="
exec "$@"
