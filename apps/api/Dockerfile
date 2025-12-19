FROM node:20-bullseye AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* turbo.json* tsconfig.base.json* ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm --filter @famfinance/api... build

FROM node:20-bullseye AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/package.json ./package.json
EXPOSE 4000
CMD ["node", "dist/main.js"]
