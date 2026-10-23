FROM node:24.18.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/web/package.json ./apps/web/package.json
COPY services/access/package.json ./services/access/package.json
COPY services/accounts/package.json ./services/accounts/package.json
COPY services/catalog/package.json ./services/catalog/package.json
COPY services/audit/package.json ./services/audit/package.json
COPY services/catalog ./services/catalog
RUN pnpm install --frozen-lockfile --filter @portal/catalog...
RUN pnpm --filter @portal/catalog build

FROM node:24.18.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
WORKDIR /app/services/catalog
EXPOSE 3003
CMD ["node", "dist/composition/main.js"]
