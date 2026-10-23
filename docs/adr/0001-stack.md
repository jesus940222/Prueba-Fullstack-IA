# ADR 0001. Stack de demostración

- Estado: aceptado para la fase 1, el 21 de octubre de 2026.
- Los lockfiles y las imágenes exactas se crean en la fase 2. Aquí no se usa la etiqueta `latest` como contrato.

## Decisión

NestJS 12 y TypeScript para Acceso, Cuentas, Catálogo y Auditoría. TypeORM 1.1.2 con `@nestjs/typeorm` 12.0.2 en los tres servicios PostgreSQL. Auditoría usa `@nestjs/mongoose` 12.0.0 y Mongoose 9.11.2, que es el adaptador descrito en la documentación de MongoDB de NestJS. IA usa FastAPI 0.157.0, SQLAlchemy 2.1.6, Alembic 1.20.0, LangGraph 1.2.16 y `qdrant-client` 1.19.1.

El frontend usa React 19.3.1, Vite 8.3.5, HeroUI `@heroui/react` y `@heroui/styles` 3.2.6, Tailwind CSS 4.3.3, React Router 8.5.0, Zustand 5.0.15, TanStack Query 5.104.5, React Hook Form 7.90.0, Zod 4.6.7 y `@hookform/resolvers` 6.0.0. Los tests de UI siguen en Jest 30.5.2 y Playwright 1.64.1. No se cambia a Vitest.

El workspace JavaScript será pnpm y el de Python uv, con lockfile propio cada uno. Node debe cumplir el suelo del CLI de NestJS 12: 22.22.3+, 24.15+ o 26+. Esta máquina tiene Node 24.18.0. Python debe cumplir `>=3.11` por SQLAlchemy 2.1.6. La imagen concreta queda para la fase 2.

## Versiones comprobadas

Se leyeron el registro npm, el índice de PyPI y estas páginas:

- NestJS TypeORM y la guía de migración a Nest 12: https://docs.nestjs.com/data/typeorm y https://docs.nestjs.com/migration-guide
- MongoDB en NestJS: https://docs.nestjs.com/data/mongodb
- HeroUI v3.0.0 y el paquete 3.2.6: https://heroui.com/docs/react/releases/v3-0-0
- Embeddings: https://developers.openai.com/api/docs/models/text-embedding-3-large
- Modelo de conversación: https://developers.openai.com/api/docs/models/gpt-6-luna
- LangGraph y variables LangSmith: https://docs.langchain.com/oss/python/langgraph/overview

`semver@7.7.2` acepta TypeORM 1.1.2 dentro del peer `^0.3.0 || ^1.0.0-dev` de `@nestjs/typeorm` 12.0.2. `@hookform/resolvers` 6 declara Zod `^3.25.0 || ^4.0.0`.

La URL de temas citada en `docs/10` (`/react/getting-started/dark-mode`) respondió 404 ese día. La fase 2 debe tomar el tema de la guía v3 vigente, con sus variables CSS, y no de ejemplos v2.

## Modelo

`OPENAI_CONVERSATION_MODEL` inicia en `gpt-6-luna`. Su página oficial lista `function_calling`, `structured_outputs`, streaming y `reasoning.effort` con `none`, `low`, `medium`, `high`, `xhigh` y `max`. El asistente usa `low`. Las llamadas con herramientas usan la Responses API. No se activan las herramientas alojadas del proveedor: MCP, shell, computer use, web search, file search ni code interpreter. Las únicas funciones son las ocho de `docs/07`.

Las tarifas leídas el 21 de octubre de 2026 en esa página, por millón de tokens, son 0.10 USD de entrada, 0.01 USD de entrada cacheada, 0.125 USD de escritura de caché y 0.50 USD de salida. Un prompt con más de 272000 tokens de entrada tiene otra tarifa; esta demostración no usa ese tramo. `text-embedding-3-large` figura a 0.13 USD por millón y 3072 dimensiones por defecto. Esas cifras entran en una tabla versionada y se revalidan antes de informar un coste. El presupuesto de demostración sigue siendo la propuesta de 1, 5 y 25 USD.

## Consecuencias

La fase 2 fija el lockfile con estas versiones o documenta el conflicto real. No se afirma que OIDC, WebAuthn u OpenAI ya funcionen.

## Ajuste de la fase 2

El 21 de octubre de 2026, `typescript@7.0.2` era la última versión del registro, pero `typescript-eslint@8.72.0` declara el peer `typescript@>=4.8.4 <6.1.0` y `ts-jest@29.4.15` declara `typescript@>=4.3 <7`. El compilador fijado es `typescript@6.0.3`, la última 6.x que ambos aceptan. `nest.json` conserva `moduleResolution: node` con `ignoreDeprecations: "6.0"` porque TypeScript 6 lo marca como obsoleto y los servicios siguen en CommonJS.

`ioredis@6.0.0` no cumple el peer `^5.0.4` de TypeORM 1.1.2. Acceso usa `ioredis@5.11.1`. El peer no se usa como caché de TypeORM.

Imágenes fijadas tras comprobar el manifiesto o el índice del registro: `postgres:17.6`, `mongo:8.0`, `redis:8.2`, `rabbitmq:4.1-management`, `qdrant/qdrant:v1.19.2-unprivileged` (el tag `1.15.4` no existía), `axllent/mailpit:v1.27`, `nginxinc/nginx-unprivileged:1.28-alpine`, `node:24.18.0-bookworm-slim`, `python:3.13.9-slim` y `ghcr.io/astral-sh/uv:0.13.4`. Jest 30 carga los paquetes ESM de Nest y React Router con `node --experimental-vm-modules` en Node 24.18.
