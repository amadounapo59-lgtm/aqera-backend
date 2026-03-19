#!/bin/sh
set -e
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

# With PostgreSQL: apply migrations (production-safe, deterministic)
if [ -n "$DATABASE_URL" ] && echo "$DATABASE_URL" | grep -qi postgres; then
  echo "Applying Prisma migrations (schema.prod.prisma)..."
  npx prisma migrate deploy --schema=prisma/schema.prod.prisma

  # Optional: set RUN_SEED=1 to run prisma/seed.ts.
  # Note: this requires ts-node to be present in the container.
  if [ "${RUN_SEED}" = "1" ]; then
    echo "Running Prisma seed (schema.prod.prisma)..."
    npx prisma db seed --schema=prisma/schema.prod.prisma
  fi
fi
exec "$@"
