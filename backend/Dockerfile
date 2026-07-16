# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY nest-cli.json tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
ARG PRISMA_GENERATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/reading_musical
RUN DATABASE_URL=$PRISMA_GENERATE_DATABASE_URL npm run prisma:generate && npm run build

FROM deps AS migration
COPY prisma.config.ts ./
COPY prisma ./prisma
CMD ["npm", "run", "prisma:deploy"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    API_PREFIX=/api/v1 \
    ASSET_OBJECT_DIR=/app/.asset-objects
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --home-dir /app --shell /usr/sbin/nologin nestjs \
  && mkdir -p /app/.asset-objects \
  && chown -R nestjs:nodejs /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN DATABASE_URL=postgresql://postgres:postgres@localhost:5432/reading_musical npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --from=build --chown=nestjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=nestjs:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client

USER nestjs
EXPOSE 3000
VOLUME ["/app/.asset-objects"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/src/main.js"]
