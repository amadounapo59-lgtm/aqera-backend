# AQERA Backend — production image (Node + Prisma PostgreSQL client)
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY prisma prisma/
# Generate Prisma client for PostgreSQL (schema.prod.prisma)
RUN npx prisma generate --schema=prisma/schema.prod.prisma

COPY . .
RUN npm run build

# ---
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY prisma prisma/
RUN npx prisma generate --schema=prisma/schema.prod.prisma

COPY --from=builder /app/dist dist/

# Prisma WASM validates env("DATABASE_URL") exists. Railway injects the real URL at runtime;
# this placeholder avoids P1012 if injection is missing until load-database-env overwrites it.
ENV DATABASE_URL="postgresql://bootstrap:bootstrap@127.0.0.1:5432/bootstrap"

ENV NODE_ENV=production
EXPOSE 3000

# Entrypoint: prisma generate + migrate deploy, then start Node
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
