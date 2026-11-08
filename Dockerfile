FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/database/package.json ./packages/database/package.json
COPY packages/anvil-engine/package.json ./packages/anvil-engine/package.json
COPY packages/crm-hubspot/package.json ./packages/crm-hubspot/package.json
COPY packages/extractor/package.json ./packages/extractor/package.json
COPY apps/worker-api/package.json ./apps/worker-api/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS runner
WORKDIR /app
COPY . .
RUN pnpm --filter @vexel/database db:generate

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/healthz || exit 1

CMD ["pnpm", "--filter", "worker-api", "exec", "tsx", "src/main.ts"]

