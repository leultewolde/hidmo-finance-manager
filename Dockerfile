FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/classification/package.json packages/classification/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/finance-engine/package.json packages/finance-engine/package.json
COPY packages/logging/package.json packages/logging/package.json
COPY packages/plaid/package.json packages/plaid/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS builder

COPY tsconfig.base.json ./
COPY apps apps
COPY packages packages

RUN pnpm --filter './packages/**' build

FROM builder AS web-builder

ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID

ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID

RUN pnpm --filter @hidmo/web build

FROM builder AS workspace-builder

RUN pnpm --filter @hidmo/worker build
RUN pnpm --filter @hidmo/worker deploy --prod /opt/hidmo-worker
RUN pnpm --filter @hidmo/database deploy --prod /opt/hidmo-migrations

FROM node:22-bookworm-slim AS web

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=8080

WORKDIR /app

COPY --from=web-builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

USER node

EXPOSE 8080

CMD ["node", "apps/web/server.js"]

FROM node:22-bookworm-slim AS worker

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

COPY --from=workspace-builder --chown=node:node /opt/hidmo-worker ./

USER node

EXPOSE 8080

CMD ["node", "dist/index.js"]

FROM node:22-bookworm-slim AS migrations

ENV NODE_ENV=production

WORKDIR /app

COPY --from=workspace-builder --chown=node:node /opt/hidmo-migrations ./

USER node

CMD ["node", "dist/cli/migrate.js"]
