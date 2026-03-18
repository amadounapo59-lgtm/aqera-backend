#!/bin/sh
set -e
# With PostgreSQL: push schema (no migration history) or use: npx prisma migrate deploy --schema=prisma/schema.prod.prisma
if [ -n "$DATABASE_URL" ] && echo "$DATABASE_URL" | grep -q postgres; then
  npx prisma db push --schema=prisma/schema.prod.prisma --accept-data-loss 2>/dev/null || true
  # Optional: set RUN_SEED=1 to run seed (image must include ts-node for prisma/seed.ts)
  # Otherwise run after start: docker-compose exec api npx prisma db seed --schema=prisma/schema.prod.prisma
  if [ "${RUN_SEED}" = "1" ]; then
    npx prisma db seed --schema=prisma/schema.prod.prisma 2>/dev/null || true
  fi
fi
exec "$@"
