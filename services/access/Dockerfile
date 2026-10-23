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
COPY services/access ./services/access
RUN pnpm install --frozen-lockfile --filter @portal/access...
RUN pnpm --filter @portal/access build

FROM node:24.18.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
WORKDIR /app/services/access
EXPOSE 3001
CMD ["node", "dist/composition/main.js"]
