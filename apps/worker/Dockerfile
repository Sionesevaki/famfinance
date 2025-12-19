FROM node:20-bullseye AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* turbo.json* tsconfig.base.json* ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm --filter @famfinance/worker... build

FROM node:20-bullseye AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/worker/dist ./dist
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/worker/package.json ./package.json
CMD ["node", "dist/main.js"]
