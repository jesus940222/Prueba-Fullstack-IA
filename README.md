# Portal financiero local

Demostración local de la prueba Senior Full-Stack. No es un sistema financiero de producción ni una certificación.

La evidencia de esta entrega está en `docs/informe-final.md` y `docs/estado-implementacion.md`. El PDF original no está en el repositorio.

## Qué incluye

Cinco servicios con datos propios: Acceso, Cuentas, Catálogo y Auditoría en NestJS, e IA en FastAPI. El navegador entra por el gateway en `http://127.0.0.1:8080`. PostgreSQL tiene una base por servicio. Auditoría usa MongoDB. Redis, RabbitMQ, Qdrant y Mailpit completan el entorno local.

## Requisitos

- Docker con Compose v2.
- Node 24.15 o superior y pnpm 10.17.1. El repositorio declara `packageManager`.
- Python 3.13 para las pruebas de IA. El entorno del servicio está en `services/ai/.venv`.

## Configuración

```powershell
pnpm install
pnpm env:local
```

`pnpm env:local` crea `.env` y no sobrescribe uno existente. `.env` está ignorado por Git. No pegues secretos en el chat ni en commits.

Las variables y los valores provisionales están en `.env.example` y `docs/contratos/variables.md`. Cada servicio usa su propia credencial de base y de RabbitMQ.

Integraciones externas, todas en `.env`:

| Variable | Uso |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Inicio con Google. El redirect de ejemplo es `http://localhost:8080/api/v1/access/auth/oidc/google/callback`. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`, `MICROSOFT_ALLOWED_ISSUERS` | Inicio con Microsoft. El emisor debe ser `https://login.microsoftonline.com/{tenant}/v2.0`. `common`, `organizations` y `consumers` no habilitan el proveedor. |
| `OPENAI_API_KEY` y `OPENAI_CONVERSATION_MODEL` | Chat e indexación. Vacía, el chat queda no disponible. No hay modelo simulado en la demo. |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`, `LANGSMITH_ENDPOINT` | Trazas externas. El valor inicial de tracing es `false`. Activarlo envía telemetría fuera de la máquina. |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_NAME` | Passkeys. En local: `localhost` y `http://localhost:8080`. |
| `SMTP_URL` | Correo capturado por Mailpit. No sale a Internet. |
| `ACCESS_BOOTSTRAP_PASSWORD` | Contraseña inicial de los cinco usuarios de demostración. Si ya existe una credencial, repetir la semilla no la rota. |

Google se registra en Google Cloud, tipo aplicación web, con el redirect exacto y un usuario de prueba. Microsoft se registra en un tenant de prueba de Entra ID, permisos delegados `openid` y `email`, con el mismo cuidado en el redirect. OpenAI y LangSmith usan una clave de proyecto de prueba. Ninguna de esas cuentas debe ser de producción financiera.

## Arranque

```powershell
docker compose --profile dev up -d --build
```

El perfil `dev` publica el gateway en `127.0.0.1:8080` y Mailpit en `127.0.0.1:8025`. Las bases, Redis, RabbitMQ y Qdrant no publican puertos al host.

Salud:

```powershell
curl.exe -sS http://127.0.0.1:8080/health
curl.exe -sS http://127.0.0.1:8080/services/access/ready
curl.exe -sS http://127.0.0.1:8080/services/accounts/ready
curl.exe -sS http://127.0.0.1:8080/services/catalog/ready
curl.exe -sS http://127.0.0.1:8080/services/audit/ready
curl.exe -sS http://127.0.0.1:8080/services/ai/ready
```

Las migraciones y las semillas corren como trabajos previos al arranque de cada servicio. Repetirlas no duplica filas ni reactiva datos borrados:

```powershell
docker compose --profile dev run --no-deps --rm access-migrate
docker compose --profile dev run --no-deps --rm accounts-migrate
docker compose --profile dev run --no-deps --rm catalog-migrate
docker compose --profile dev run --no-deps --rm audit-migrate
docker compose --profile dev run --no-deps --rm ai-migrate
```

Detener sin borrar volúmenes:

```powershell
docker compose --profile dev stop
```

`docker compose down -v` borra Postgres, Mongo, Redis, RabbitMQ y Qdrant. No forma parte del arranque normal.

Una comprobación aislada usa volúmenes nuevos y los puertos `18080` y `18025`. Ese archivo deja vacía `OPENAI_API_KEY` para que el arranque no llame al proveedor:

```powershell
docker compose -p guia-entrega -f compose.yaml -f compose.isolated.yaml --profile dev up -d --build
```

Ese proyecto no reemplaza los volúmenes de `guia-portal`. Para quitar solo ese proyecto, incluido su volumen de prueba:

```powershell
docker compose -p guia-entrega -f compose.yaml -f compose.isolated.yaml --profile dev down -v
```

## Demostración

Abre `http://localhost:8080/entrar`. La contraseña es la de `ACCESS_BOOTSTRAP_PASSWORD` en `.env`. El código de correo aparece en `http://127.0.0.1:8025`.

| Persona | Correo | Recorrido |
|---|---|---|
| Ana | `ana.cliente@portal.local` | Cuentas, movimientos, beneficiarios, transferencia, límites, ofertas y chat. No administra usuarios ni métricas de IA. |
| Bruno | `bruno.soporte@portal.local` | Usuarios en lectura limitada. No entra a las cuentas de Ana. |
| Carla | `carla.auditor@portal.local` | Auditoría. No administra el catálogo ni las cuentas. |
| Diego | `diego.admin@portal.local` | Usuarios, roles, asignaciones, métricas y alertas de IA. No ve el texto del chat de Ana. |
| Elena | `elena.gestor@portal.local` | Productos, ofertas y administración de catálogo. Sin cuentas ni auditoría. |

Rutas directas, servidas por la SPA: `/`, `/cuentas`, `/beneficiarios`, `/transferencias`, `/limites`, `/productos`, `/ofertas`, `/catalogo`, `/auditoria`, `/chat`, `/ia`, `/perfil`, `/sesiones`, `/usuarios`, `/roles`, `/preferencias`, `/salud`.

El chat puede preparar una transferencia. La confirmación es el botón de Cuentas, no un mensaje del modelo. Una ruta `/api/` desconocida responde JSON 404, no el HTML de la SPA.

## Pruebas

```powershell
pnpm typecheck
pnpm lint
pnpm build
pnpm check:architecture
pnpm --filter @portal/access test
pnpm --filter @portal/accounts test
pnpm --filter @portal/catalog test
pnpm --filter @portal/audit test
pnpm --filter @portal/web test
services\ai\.venv\Scripts\python.exe -m pytest tests -q
```

El último comando se ejecuta dentro de `services/ai`. La evaluación versionada, sin llamar al proveedor:

```powershell
services\ai\.venv\Scripts\python.exe eval\run_eval.py
```

También dentro de `services/ai`. Imprime `mode=not_run`. No inventa latencia ni coste.

Con el gateway ya en marcha:

```powershell
pnpm test:e2e:access
pnpm exec playwright test -c playwright.accounts.config.ts
pnpm exec playwright test -c playwright.catalog.config.ts
pnpm exec playwright test -c playwright.ai.config.ts
```

Los recorridos de Playwright leen `ACCESS_BOOTSTRAP_PASSWORD` desde `.env` si `E2E_BOOTSTRAP_PASSWORD` no está en el entorno. No hace falta copiar la contraseña a otro archivo. El recorrido de cuentas debita 1.00 MXN del volumen de demostración. No envía correo fuera de Mailpit.

Informes de cobertura, generados por esas ejecuciones:

| Servicio | Informe |
|---|---|
| Acceso | `services/access/coverage/` |
| Cuentas | `services/accounts/coverage/` |
| Catálogo | `services/catalog/coverage/` |
| Auditoría | `services/audit/coverage/` |
| Web | `apps/web/coverage/` |
| IA | `services/ai/htmlcov/` y `services/ai/coverage.xml` |

## Documentos

| Archivo | Contenido |
|---|---|
| `docs/01` a `docs/08` | Alcance, dominio, contratos, seguridad, frontend, IA y Docker |
| `docs/09-diagnostico.md` | Runbook del ejercicio. No es un incidente observado |
| `docs/diagnostico-respuesta.md` | Respuesta del ejercicio con la arquitectura real |
| `docs/10-trazabilidad-prueba.md` | Requisitos del PDF y evidencia |
| `docs/informe-final.md` | Entrega: comandos, cobertura, defectos y bloqueos |
| `docs/estado-implementacion.md` | Registro de fases |
| `docs/openapi/` | Contratos HTTP |
| `docs/adr/` | Decisiones |
| `docs/arquitectura.mmd` y `docs/flujos/` | Diagramas |

Los números de sesión, transferencia e IA son propuestas configurables. No son requisitos literales del PDF.

## Límites

OIDC de Google redirige si hay credenciales, pero el regreso con una cuenta real no se completó en esta entrega. Microsoft permanece apagado hasta configurar emisores explícitos. La ceremonia WebAuthn no se ejecutó con un autenticador. LangSmith permanece apagado. La evaluación de diez casos no llamó al proveedor. No hay recolector central de logs: la inspección local es `docker compose logs`.
