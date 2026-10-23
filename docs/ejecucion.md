# Ejecución de la fase 2

Fecha: 21 de octubre de 2026.
Alcance: base ejecutable y Docker (`prompts/02-base-y-docker.md`).
La fase 3 cerró después de este gate. Su evidencia está al final de este archivo.

Esta base arranca en local, responde salud y readiness, aplica migraciones vacías y muestra un shell. No inicia sesión, no mueve dinero, no consulta catálogo ni auditoría de negocio y no conversa con un modelo.

## Resultado del gate

El gate de la fase 2 pasó para la base. El daemon de Docker estaba disponible. Los volúmenes del proyecto `guia-portal` no se borraron. El stack quedó levantado con el perfil `dev`.

Para detenerlo sin borrar datos:

```text
docker compose --profile dev stop
```

`docker compose down -v` no se ejecutó.

## Comandos y resultados

| Comando | Resultado |
|---|---|
| `pnpm install` | Lockfile `pnpm-lock.yaml`. Aviso de scripts de build ignorados para `@parcel/watcher` y `unrs-resolver`. Dependencias transitivas deprecadas `glob@10.5.0` y `whatwg-encoding@3.1.1`. No se trataron como fallo. |
| `python -m uv lock` y `python -m uv sync --dev` en `services/ai` | `uv.lock`. `uv` 0.13.4 se instaló con pip porque no estaba en PATH. |
| `pnpm typecheck` | Pasó. |
| `pnpm lint` | Pasó, sin hallazgos. |
| `pnpm build` | Pasó. |
| `pnpm check:architecture` | `architecture_ok`. |
| `pnpm test` | Salió 0 el 21 de octubre de 2026, después del último cambio de pruebas. Arquitectura 4, contratos 1, web 2 suites / 4 tests (sentencias 97.87%), acceso 14 / 36 (95.52%), cuentas 12 / 32 (95%), catálogo 12 / 32 (95%), auditoría 12 / 31 (95%). |
| `python -m uv run pytest` en `services/ai` | 7 passed. Cobertura 91.62%. Umbral 70% alcanzado. |
| `pnpm exec playwright install chromium`, build de web y `pnpm exec playwright test` | 1 passed contra `vite preview` en `127.0.0.1:4173`: deep link `/preferencias`, nombre local y tema oscuro tras recarga. |
| `pnpm env:local` | Escribió `.env` y se negó a sobrescribirlo después. `.env` está en `.gitignore` y no se imprime. |
| `docker compose --profile dev config --quiet` | `compose_config_ok`. |
| `docker compose --profile dev up -d --build` | El segundo intento salió 0. El primero falló en `ai-migrate`; ver correcciones. |
| `docker compose run --rm --no-deps` de los cinco jobs de migración, sobre el mismo volumen | Acceso, cuentas y catálogo `{"applied":[]}`. Auditoría repitió `event_id_unique` y `correlation_id`. IA `{"applied":"head"}`. |

Node v24.18.0, pnpm 10.17.1, Python 3.13.9. Jest 30 arranca con `node --experimental-vm-modules` porque Nest y React Router son ESM.

## Arranque y migraciones

Proyecto Compose `guia-portal`, perfil `dev`. Puertos publicados: gateway `127.0.0.1:8080` y Mailpit `127.0.0.1:8025`. El resto queda en la red interna.

El volumen de PostgreSQL era nuevo: el bootstrap registró `CREATE DATABASE` y, en un pase posterior, el mismo script fue idempotente. En `access`, `accounts` y `catalog` la tabla `migrations` tiene una fila, `Baseline1730000000000`. En `ai`, `alembic_version` es `20261021_0001`. Esas migraciones no crean tablas de negocio. `synchronize` y `migrationsRun` permanecen en falso.

La segunda ejecución, con `docker compose run --rm --no-deps` sobre el volumen existente, no añadió filas ni revisiones. El log conservado del contenedor original de acceso muestra `applied: []` porque ese contenedor se volvió a ejecutar después de que la fila ya existía. La evidencia de la primera aplicación es la fila en la base, no esa línea de log.

Auditoría creó los índices `event_id_unique` y `correlation_id`. Rabbit declaró `portal.events`, `audit.events`, la DLQ y la DLX, y el log fue `rabbit_bootstrap_ok`. Mongo creó los roles y usuarios previstos; el log fue `mongo_bootstrap_ok`. Qdrant recibió la colección `knowledge` con índices de payload. Qdrant no tiene healthcheck de Compose; el job de IA espera `/healthz`.

`GET http://127.0.0.1:8080/health` respondió 200 `{"status":"ok","service":"gateway"}`. Readiness de acceso, cuentas, catálogo, auditoría e IA respondió 200 con las sondas listadas en `up`, incluido SMTP porque Mailpit está en el perfil `dev`. `/api/v1/no-existe` y `/internal/v1/access/authorize` respondieron 404 JSON. `/preferencias` respondió HTML `es-MX`.

Capacidades después de vaciar las claves externas y recrear acceso e IA:

- Acceso: Google, Microsoft y OpenAI `missing`; WebAuthn, SMTP y firma JWT `configured`. Todas `verified: false`.
- IA: OpenAI `missing`, Qdrant `configured`, LangSmith `missing`. Todas `verified: false`.

Una clave presente no se trata como proveedor verificado. Las claves de Google, Microsoft, OpenAI y LangSmith quedan vacías en `.env.example` y en el `.env` local.

## Shell en el navegador

Se abrió `http://127.0.0.1:8080/preferencias` en el navegador del IDE.

- Enviar el nombre vacío muestra la alerta "Escribe un nombre para mostrar" y el campo queda inválido.
- "Ana López" confirma "El nombre queda solo en esta pantalla" y declara que no se envió a ningún servicio.
- "Oscuro" deja `data-theme=dark` y `localStorage` `heroui-theme=dark`. Tras recargar `/preferencias`, el tema sigue oscuro y el nombre vuelve a estar vacío.
- `/salud` muestra "Respuesta del servicio: ok", leída del gateway con los servicios arriba.
- A 390 px el menú nace contraído, se abre y navega a Preferencias.

Playwright ya había cubierto el deep link contra `vite preview`. Esta pasada cubre el gateway publicado.

## Correcciones durante el gate

- TypeScript se fijó en 6.0.3. La 7.0.2 no cumple el peer de `typescript-eslint` 8.72.0 ni el de `ts-jest` 29.4.15. `ioredis` quedó en 5.11.1 por el peer de TypeORM. Quedó anotado en `docs/adr/0001-stack.md`.
- La imagen `qdrant/qdrant:1.15.4` no existe. Se usa `qdrant/qdrant:v1.19.2-unprivileged`.
- El primer `ai-migrate` falló: un `__init__.py` vacío hacía que el directorio local `alembic/` ocultara el paquete instalado. Se eliminaron esos `__init__.py` y el job reconstruido salió 0.
- `pnpm env:local` había generado valores para OpenAI, Google, Microsoft y LangSmith. La presencia los marcaba como configurados. Esas claves pasaron a externas, siempre vacías, y se vaciaron en el `.env` existente sin imprimirlas.
- Vite 8 cargaba `vite.config.ts` como CommonJS. La configuración quedó en `apps/web/vite.config.mts`.

## Qué no quedó verificado

- No hay ceremonia WebAuthn, ni login OIDC, ni llamada a OpenAI. La firma JWT solo se comprueba por presencia y longitud.
- La sonda SMTP es TCP hacia Mailpit, no una sesión autenticada. Sin el perfil `dev`, SMTP queda degradado y no tumba el servicio.
- La sonda Rabbit de IA es TCP. En Nest es una conexión AMQP.
- Redis caído degrada; no es la dependencia obligatoria.
- Qdrant no tiene healthcheck de Compose.
- La cobertura excluye fábricas de drivers, composición y runners de migración. El dominio entra en el umbral.
- `knowledge/` solo contiene `.gitkeep`. No hay documentos RAG ni seeds de negocio.
- pnpm no ejecutó los scripts de build de `@parcel/watcher` ni `unrs-resolver`.

El stack es una demostración local. No es un sistema financiero de producción ni una certificación.

## Fase 3 cerrada

Fecha: 21 de octubre de 2026. Alcance: Acceso (`prompts/03-acceso.md`). El gate local pasó. No es un sistema financiero de producción ni una certificación.

Comandos y resultados de este cierre:

- `pnpm --filter @portal/access test`: 18 suites pasadas, 1 omitida, 62 tests pasados y 2 omitidos, salida 0. Sentencias 85.85 %, ramas 74.12 %, funciones 92.36 %, líneas 85.73 %. La suite omitida en el host es `last-admin.integration.spec.ts`, porque no hay `ACCESS_GATE_DATABASE_URL`. `access-handler.ts` entra en el recuento y queda en ramas 58.88 %.
- La misma integración, montando el código en un contenedor de Acceso y apuntando a la base `access_gate`: 2 tests pasados. El candado de transacción mantuvo un solo administrador durante el solape (854 ms). Dos `revokeAssignment` concurrentes dejaron exactamente un administrador efectivo (53 ms).
- `pnpm --filter @portal/web test`: 6 suites, 18 tests, salida 0. Sentencias 86.04 %, ramas 76 %, funciones 88.33 %, líneas 86.60 %. `src/pages` queda en ramas 68.15 %.
- `node scripts/check-architecture.mjs`: `architecture_ok`.
- `pnpm test:e2e:access`: 1 test pasado en 2.1 s contra `http://127.0.0.1:8080`. El proveedor controlado es Mailpit. Diego entra, ve perfil, sesiones, usuarios, asignaciones y roles, y cierra sesión. Ana no ve el enlace de usuarios y recibe la alerta de permiso en `/usuarios` y `/roles`.
- Dentro de Acceso, contra `127.0.0.1:3001` y Mailpit: login 200 `EMAIL_CHALLENGE`, verificación 200 `AUTHENTICATED`, authorize 200 `allow` / `authorized`, logout 204. El gateway en el puerto 8080 responde 404 a `POST /internal/v1/access/authorize`.
- `outbox_events` tiene dos `session.revoked` con `published_at`. `rabbitmqadmin get messages --queue audit.events --count 2 --ack-mode ack_requeue_true` devolvió esos dos sobres. No contienen contraseña ni token. Auditoría no consume la cola.
- El navegador en `/entrar` muestra el formulario y los enlaces de los proveedores. `/` muestra que el acceso local ya usa el buzón de prueba.

Límites que siguen abiertos:

- Google y Microsoft no tienen credenciales. El arranque OIDC responde 503. No se acredita autenticación externa.
- No hubo ceremonia WebAuthn física ni virtual.
- La SPA no ofrece pantallas de invitación, restablecimiento, vinculación ni cierre de recuperación. El API sí las tiene.
- Postgres, criptografía y el publicador quedan fuera del porcentaje de cobertura. La base `access_gate` sigue en el volumen. OpenAPI no incluye `AuthStep.options`.
- El arreglo de `query()` desenvuelve el resultado `[rows, affected]` de TypeORM en `UPDATE` y `DELETE`. Sin eso, la revocación escribía `session_id` como `undefined`. La imagen de Acceso en ejecución incluye ese arreglo: el logout real publicó UUID válidos.
