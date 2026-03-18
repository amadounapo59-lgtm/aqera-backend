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
RUN npm ci --omit=dev

COPY prisma prisma/
RUN npx prisma generate --schema=prisma/schema.prod.prisma

COPY --from=builder /app/dist dist/

ENV NODE_ENV=production
EXPOSE 3000

# Entrypoint: sync DB schema (db push), then start (migrate deploy if you have PG migrations)
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
