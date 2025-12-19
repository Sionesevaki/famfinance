FROM node:20-bullseye AS base
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* turbo.json* tsconfig.base.json* ./
COPY packages/db ./packages/db
RUN pnpm install --frozen-lockfile --filter @famfinance/db...

FROM deps AS runtime
WORKDIR /repo/packages/db
ENV NODE_ENV=production
CMD ["pnpm", "migrate:deploy"]

