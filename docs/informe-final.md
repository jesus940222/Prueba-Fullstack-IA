# Informe final

Fecha: 21 de octubre de 2026. Demostración local. No es un sistema financiero de producción ni una certificación.

El PDF original no está en el repositorio. La comparación usa `docs/10-trazabilidad-prueba.md`, que se actualizó con esta ejecución, y la especificación de `docs/01` a `docs/09`.

## 1. Funcionalidades entregadas

- Acceso: contraseña, código en Mailpit, sesiones, roles, asignaciones, revocación y JWKS. Google redirige si hay credenciales. Microsoft no arranca sin un emisor explícito.
- Cuentas: saldos MXN, beneficiarios, límites y transferencia con idempotencia. El chat no confirma.
- Catálogo: productos, ofertas por audiencia y borrado lógico.
- Auditoría: consumidor de eventos, consulta y deduplicación por `event_id`.
- IA: chat con herramientas, RAG de `knowledge/`, métricas y reglas de aviso. LangSmith apagado.
- Frontend en `http://localhost:8080`, con rutas internas servidas por la SPA.

## 2. Matriz

La matriz completa está en `docs/10-trazabilidad-prueba.md`. Resumen: los cinco servicios, la arquitectura, Compose, la cobertura agregada y los recorridos de Ana, Bruno, Carla, Diego y Elena están verificados en código y, donde se indica abajo, en el gateway. OIDC completo, passkeys con autenticador, el dataset de IA y LangSmith quedan parciales o pendientes.

## 3. Comandos y resultados

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | Salida 0. |
| `pnpm lint` | Salida 0 después de quitar la variable sin uso en la integración de Catálogo. |
| `pnpm build` | Salida 0. |
| `node scripts/check-architecture.mjs` | `architecture_ok`. |
| `node --test scripts/check-architecture.test.mjs` | 4 pasados. |
| `pnpm --filter @portal/access test` | 19 suites pasadas, 1 omitida, 66 tests pasados, 2 omitidos. Sentencias 86 %, ramas 74.48 %, funciones 92.41 %, líneas 85.87 %. |
| `pnpm --filter @portal/accounts test` | 18 pasadas, 1 omitida, 53 pasados, 3 omitidos. Sentencias 94.42 %, ramas 84.80 %, funciones 98.77 %, líneas 94.21 %. |
| `pnpm --filter @portal/catalog test` | 16 pasadas, 1 omitida, 47 pasados, 2 omitidos. Sentencias 79.24 %, ramas 72.01 %, funciones 79.77 %, líneas 78.56 %. |
| `pnpm --filter @portal/audit test` | 16 pasadas, 1 omitida, 40 pasados, 1 omitido. Sentencias 91.76 %, ramas 77.39 %, funciones 88.34 %, líneas 91.40 %. |
| `pnpm --filter @portal/web test` | 10 suites, 31 tests, salida 0. Sentencias 84.77 %, ramas 72.09 %, funciones 87.87 %, líneas 84.86 %. |
| `pytest` en `services/ai` | 28 pasados. Cobertura total 76.22 %. |
| `python eval/run_eval.py` | No se volvió a ejecutar en esta fase. El script sigue en `mode=not_run` y no llama al modelo. |
| Migraciones repetidas en `guia-portal` | `applied` vacío en Acceso, Cuentas y Catálogo. Auditoría reafirmó índices. IA `applied: head`. Conteos iguales: 5 usuarios, 3 clientes, 9 movimientos, 5 productos, 5 documentos. |
| `GET /api/v1/access/auth/oidc/microsoft/start` | 503 `DEPENDENCY_UNAVAILABLE`. |
| `GET /api/v1/access/auth/oidc/google/start` | 302, host `accounts.google.com`. |
| `GET /api/v1/missing` | 404 JSON `RESOURCE_NOT_VISIBLE`. |
| Rutas `/entrar`, `/cuentas`, `/ofertas`, `/auditoria`, `/chat`, `/ia` | 200 HTML de la SPA. |
| Playwright acceso, cuentas y catálogo | 1 test pasado en cada archivo. |
| Proyecto `guia-entrega` | Healthy en `127.0.0.1:18080`. OpenAI vacío. 5 usuarios, 3 clientes, 5 productos. Segunda migración de Acceso: `applied` vacío y 5 usuarios. |

Las suites de integración con Postgres y Mongo quedaron omitidas: el puerto de la base no está publicado y no se creó un reenvío en esta fase. Las reglas que cubren siguen en las pruebas de dominio, que sí pasaron.

## 4. Cobertura

Informes HTML y lcov de Jest:

- `services/access/coverage/`
- `services/accounts/coverage/`
- `services/catalog/coverage/`
- `services/audit/coverage/`
- `apps/web/coverage/`

IA: `services/ai/htmlcov/` y `services/ai/coverage.xml`.

El agregado de cada servicio supera el 70 % en sentencias, ramas, funciones y líneas del código que la herramienta incluye. Quedan fuera composición, semillas, almacenes Postgres/Mongo y el adaptador de Qdrant, como en las fases anteriores. Dentro del agregado, `catalog-handler.ts` sigue bajo en ramas y, en IA, `conversations.py` y `chat_routes.py` también. La carpeta `apps/web/src/pages` queda en ramas por debajo del 70 %; el total del frontend no.

## 5. Defectos corregidos y pendientes

Corregidos en esta fase:

- Microsoft usaba el tenant `common` aunque no hubiera emisores. Ahora responde 503 y la pantalla no muestra el enlace.
- `AuthStep` en OpenAPI no admitía `options`. El campo quedó opcional.
- ESLint fallaba por una variable sin uso en `catalog.integration.spec.ts`.
- Qdrant no tenía healthcheck. La sonda TCP quedó healthy en el proyecto de demostración.
- Un 401 borraba también la consulta en vuelo y `/cuentas` sin sesión podía quedarse en «Cargando cuentas…».
- Playwright no veía la contraseña de `.env`. Los configs leen `ACCESS_BOOTSTRAP_PASSWORD` sin imprimirla.

Pendientes:

- Callback de Google con una cuenta real.
- `MICROSOFT_ALLOWED_ISSUERS` vacío.
- Ceremonia WebAuthn.
- `eval/run_eval.py` no ejecuta los 10 casos.
- Avisos del 80 % y del 100 % no se dispararon: el coste observado está por debajo de 0.80 USD.
- Integraciones de base `*_gate` no se repitieron hoy.
- No se apagó Rabbit ni Mongo del volumen de demostración.

## 6. Integraciones

| Integración | Estado |
|---|---|
| Postgres, Mongo, Redis, RabbitMQ, Qdrant, Mailpit | Verificadas en readiness y en los recorridos locales. |
| OpenAI | Clave presente. El modelo respondió en la fase 6. Esta fase no repitió el chat para no generar otro cargo. El arranque aislado dejó la clave vacía y no indexó. |
| Google | Credenciales presentes. El arranque redirige. El regreso con un usuario real no se hizo. |
| Microsoft | Identificador y secreto presentes. Emisores vacíos. La capacidad figura `missing` y el arranque responde 503. |
| WebAuthn | RP `localhost` y origen `http://localhost:8080`. Sin ceremonia. |
| LangSmith | Clave presente, `LANGSMITH_TRACING=false`, proyecto vacío. No se exportó telemetría. |
| Correo | Solo Mailpit. No hubo envío externo. |

## 7. Configuración pedida

Nada de esto va en el chat. Se escribe en `.env`, que Git ignora, y luego se recrea el servicio.

1. `MICROSOFT_ALLOWED_ISSUERS`. La necesita el inicio de sesión con Microsoft. En Entra ID, registra una aplicación web de prueba con redirect `http://localhost:8080/api/v1/access/auth/oidc/microsoft/callback` y permisos delegados `openid` y `email`. El valor es `https://login.microsoftonline.com/{tenant}/v2.0`, de un tenant de prueba. No uses `common`, `organizations` ni `consumers`. El identificador y el secreto ya están en `.env`.
2. Para completar Google, hace falta un usuario de prueba del cliente OAuth ya configurado y entrar en el navegador en «Continuar con Google». No es un cargo. El redirect ya responde.
3. `LANGSMITH_PROJECT`, y autorización explícita para poner `LANGSMITH_TRACING=true`. La clave ya está. Activarlo envía telemetría fuera de la máquina. Sirve un proyecto de prueba de LangSmith.
4. Autorización para ejecutar `eval/run_eval.py` contra OpenAI y el e2e `playwright.ai.config.ts`. Son unos diez casos más un mensaje de chat. Una conversación anterior costó alrededor de 0.06 USD. No se ejecutaron en esta fase.
5. Passkeys: un autenticador del navegador en `http://localhost:8080`. Habilitar la política en un usuario de demostración revoca su sesión. Conviene un usuario nuevo, no uno de los cinco de la semilla, si se quiere probar.

## 8. Cómo reproducir la demostración

```powershell
pnpm install
docker compose --profile dev up -d --build
```

Abre `http://localhost:8080/entrar`. La contraseña es `ACCESS_BOOTSTRAP_PASSWORD` en `.env`. El código llega a `http://127.0.0.1:8025`.

Ana (`ana.cliente@portal.local`) ve cuentas, ofertas y el asistente. Bruno no entra a las cuentas de Ana. Carla abre Auditoría. Diego abre usuarios y métricas. Elena administra el catálogo. Las rutas están en el README.

Detener sin borrar datos:

```powershell
docker compose --profile dev stop
```

El proyecto aislado `guia-entrega` ya se detuvo. Sus volúmenes no se borraron. Para quitarlos hace falta una orden explícita, y no debe incluir el proyecto `guia-portal`:

```powershell
docker compose -p guia-entrega -f compose.yaml -f compose.isolated.yaml --profile dev down -v
```

Esa orden no se ejecutó.
