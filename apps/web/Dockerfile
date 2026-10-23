FROM node:24.18.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/web ./apps/web
COPY services/access/package.json ./services/access/package.json
COPY services/accounts/package.json ./services/accounts/package.json
COPY services/catalog/package.json ./services/catalog/package.json
COPY services/audit/package.json ./services/audit/package.json
RUN pnpm install --frozen-lockfile --filter @portal/web...
RUN pnpm --filter @portal/web build

FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
