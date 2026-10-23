# Estado de implementación

Fecha de este registro: 21 de octubre de 2026.

Es una demostración local. No es un sistema financiero de producción ni una certificación.

## Fase

| | |
|---|---|
| Última fase completada | Fase 7, verificación, documentación y entrega (`prompts/07-entrega.md`). El detalle está en `docs/informe-final.md`. |
| Fase actual | Ninguna en curso. |
| No iniciadas | Ninguna. El cierre deja integraciones externas sin verificación real, listadas en el informe. |

La fase 2 no se reabre. La fase 3 cierra el gate de `prompts/03-acceso.md` con los límites de la sección de fallos: no hay smoke real de Google o Microsoft, ni ceremonia WebAuthn en un autenticador.

## Requisitos

### Implementados y comprobados

- Cinco servicios con dueño de datos propio, NestJS en Acceso, Cuentas, Catálogo y Auditoría, FastAPI en IA. Dominio sin frameworks; `scripts/check-architecture.mjs` lo comprueba.
- Contratos de la fase 1: OpenAPI, eventos, catálogo de permisos, ADRs, diagrama y trazabilidad. No se reescribieron para hacer pasar pruebas.
- Compose del perfil `dev`: Postgres (cuatro bases), MongoDB, Redis, RabbitMQ, Qdrant `v1.19.2-unprivileged`, gateway, Mailpit. Volúmenes del proyecto `guia-portal` conservados. `docker compose down -v` no se ejecutó.
- Salud y readiness honestos. Credenciales externas vacías se reportan como no configuradas, no como verificadas.
- Acceso, en código y en un humo local: usuarios y roles de sistema por semilla idempotente; contraseña con Argon2id; login que abre desafío de correo y no sesión plena; código capturado en Mailpit; verificación que deja cookie de sesión; contraseña incorrecta en 401; JWKS público sin material privado; Google sin credenciales en 503.
- Reglas de dominio cubiertas por pruebas unitarias: delegación, no autoasignación, último administrador en memoria, restauración que deja al usuario deshabilitado y sin credenciales reactivadas, reutilización de refresh, OTP, passkey y recuperación administrativa deshabilitada (`422 RECOVERY_POLICY_DISABLED`).
- Frontend de Acceso: entrar, código de correo, enlaces de Google y Microsoft, perfil, teléfono y tema, sesiones, usuarios, roles y asignaciones. React Hook Form, Zod y paginación en la URL. El menú de usuarios exige `users:read` y el de roles exige `roles:read`. La UI de alta y de uso de passkey llama al navegador; no se ejecutó una ceremonia.
- Concurrencia del último administrador en Postgres: dos conexiones y el candado `pg_advisory_xact_lock` dejan un administrador efectivo.
- E2E de login y permisos contra el gateway y Mailpit, con `diego.admin@portal.local` y `ana.cliente@portal.local`.
- Outbox `session.revoked` publicado en `portal.events` y presente en la cola `audit.events`, sin secreto en el cuerpo.
- `POST /internal/v1/access/authorize` con JWT HS256 del servicio `accounts`: decisión `allow`. El gateway responde 404 en `/internal/`.
- El adaptador HTTP entra en el recuento de cobertura. El agregado del servicio sigue por encima del 70 %.

### Límites que no cierran un smoke real

- OIDC de Google y Microsoft. Sin credenciales, el arranque responde 503. No hay registro real.
- Ceremonia WebAuthn. El servidor y la UI están. No se usó un autenticador físico ni virtual sobre el volumen de demostración.
- La SPA no tiene pantallas de invitación, restablecimiento de contraseña, vinculación de identidad ni cierre de recuperación administrativa. Esas operaciones existen en el API y en las pruebas del servicio.

### Fase 4, comprobada en este registro

- Cuentas posee clientes, cuentas MXN, movimientos, beneficiarios, límites, propuestas y transferencias. El vínculo `user_customers.user_id` no es clave foránea hacia Acceso.
- Migración `AccountsSchema1732100000000`. Semilla idempotente: tres clientes, seis movimientos de apertura, una compra de 150.00 y dos beneficiarios de Ana. El gasto comercial cuenta solo compras del día `America/Mexico_City`.
- Confirmación en una transacción: candados, débito condicionado al saldo, crédito, dos movimientos, consumo diario, idempotencia y outbox. TypeORM devuelve `[filas, conteo]` en `UPDATE`; el almacén lee las filas antes de comparar el saldo.
- La UI confirma con una clave de idempotencia estable. Un estado 0, 502, 503 o 504, o un fallo de red, queda incierto y no invalida el saldo. La recuperación consulta la transferencia o reintenta la misma clave.
- Acceso acepta `requireRecentVerification` opcional en `POST /internal/v1/access/authorize`. Si la verificación no es reciente, la decisión es `deny` con `recent_verification_required`. Cuentas no lee la base de Acceso. Ese cambio está cubierto por las pruebas de Acceso.

### Fase 5, comprobada en este registro

- Catálogo posee categorías, productos, condiciones JSONB, ofertas, reglas y asignaciones. PostgreSQL y TypeORM, migración `CatalogSchema1732200000000`, `synchronize` apagado. Los atributos se validan en dominio con esquemas de versión 1 para `inversion`, `prestamo` y `seguro`.
- Ofertas `general`, `rules` y `direct`. Una oferta vencida, futura, inactiva o de un producto eliminado no es elegible. Si Cuentas no responde, la consulta de ofertas propias responde 503 y no concede la oferta por reglas. Si el contexto no es verificable, tampoco. La general y la asignación directa no usan ese fallo para conceder una oferta por reglas.
- El usuario de la sesión se resuelve con `POST /internal/v1/accounts/customer-link`. El contexto financiero sale de `POST /internal/v1/accounts/eligibility-context`. Catálogo no abre la base de Cuentas. Sin vínculo activo, la lista de ofertas queda vacía.
- Borrado lógico. Eliminar un producto desactiva en la misma transacción las ofertas que seguían activas. Restaurar el producto no las reactiva. Restaurar una oferta la deja `disabled`.
- La semilla no amplía al administrador de accesos. `gestor-catalogo` ya existía y sigue sin ser asignable por ese administrador. No hay contratación ni registro de interés.
- Los cambios de producto y oferta escriben outbox `product.changed` y `offer.changed`. No hay tipo de bus para categoría, así que un cambio de categoría no se publica.
- Auditoría persiste en MongoDB, colección `events`, índices `event_id` único, `correlation_id`, `occurred_at`, `actor_id` y `event_type`. El consumidor de `audit.events` confirma después de insertar. Un `event_id` repetido no crea otra fila. Un mensaje inválido o agotados los reintentos se rechaza sin reencolar; el broker lo mueve a `audit.events.dlq`. `reprocessDeadLetters` vuelve a leer esa cola y se detiene ante un mensaje que no puede persistir.
- Las consultas son GET, con filtros, página y rango inclusivo de hasta 31 días. `audit.query` se inserta en Mongo y no se publica a Rabbit. No hay endpoints de modificación ni de borrado.
- La UI usa HeroUI v3, React Hook Form y Zod en administración de catálogo y filtros de auditoría. Productos, ofertas, catálogo y auditoría muestran carga, vacío, error y permiso denegado.

### Fase 6, comprobada en este registro

- IA posee conversaciones, mensajes, ejecuciones, documentos, trabajos de indexación, reglas y alertas. PostgreSQL propio, SQLAlchemy y Alembic. La migración `20261021_0002` crea `ai_records`. Dominio y casos de uso no importan FastAPI, SQLAlchemy, LangGraph ni los SDK de proveedores. `scripts/check-architecture.mjs` responde `architecture_ok`.
- El chat usa LangGraph con un saver que redacta secretos. La confirmación de una transferencia no es una herramienta. El frontend confirma en `POST /api/v1/accounts/transfer-proposals/:id/confirm`. Un sí en el chat no sustituye ese botón.
- RAG indexa los cinco documentos aprobados de `knowledge/` con `text-embedding-3-large` y 3072 dimensiones. Qdrant `knowledge` quedó con 8 puntos. Un documento administrativo no entra en la audiencia general. El coste de indexación queda en el trabajo y no se suma al coste del chat.
- Las herramientas leen Cuentas y Catálogo con la cookie de la sesión. La identidad no sale de los argumentos del modelo. Acceso expone `POST /internal/v1/access/alert-recipients`, solo para el servicio `ai`. Sin `userIds` devuelve administradores activos con `ai:alerts:read`.
- Métricas: tokens, modelo y coste estimado. Un uso incompleto queda en null. Hay seis reglas de aviso, al 80 % y al 100 % de 1.00, 5.00 y 25.00 USD, con cooldown `AI_ALERT_COOLDOWN` (1800 s). Esas reglas no bloquean; los topes de presupuesto, pasos, tokens, tiempo y concurrencia sí.
- LangSmith queda apagado si `LANGSMITH_TRACING` no es verdadero. En este entorno el valor es `false`. La clave existe y no se usó.
- El portal muestra `/chat` y `/ia`. Ana puede conversar y recibe 403 en métricas administrativas. Diego abre el panel y no ve el texto del chat de Ana.
- Prompts `services/ai/prompts/system-v1.md`, ejemplos `few-shot-v1.json` y conjunto `eval/dataset-v1.json`. `eval/run_eval.py` imprime `mode=not_run` si no se pide la evaluación real. No se ejecutó ese conjunto contra el proveedor.

### Fuera de la entrega

No hay una fase posterior. Lo que sigue abierto está en `docs/informe-final.md`: callback real de Google, emisores de Microsoft, ceremonia WebAuthn, evaluación de IA contra el proveedor, LangSmith y el e2e de chat, que no se repitió porque llama a OpenAI.

## Fase 7, comprobada en este registro

- `pnpm typecheck`, `pnpm lint` y `pnpm build` salieron 0. `node scripts/check-architecture.mjs` imprimió `architecture_ok`.
- Pruebas de servicio, sin las integraciones de base porque no se publicó el puerto: Acceso 66 pasados y 2 omitidos; Cuentas 53 pasados y 3 omitidos; Catálogo 47 pasados y 2 omitidos; Auditoría 40 pasados y 1 omitido. Web 31 pasados. IA 28 pasados, cobertura total 76.22 %. Los agregados incluidos quedan por encima del 70 %.
- Microsoft ya no redirige a `/common` si `MICROSOFT_ALLOWED_ISSUERS` está vacío. `GET /api/v1/access/auth/oidc/microsoft/start` respondió 503 `DEPENDENCY_UNAVAILABLE`. Google, con credenciales presentes, respondió 302 hacia `accounts.google.com`. El callback no se completó.
- La pantalla de entrada solo muestra el proveedor cuya capacidad está configurada. En el navegador apareció Google y no Microsoft.
- Repetir migraciones sobre `guia-portal` devolvió `applied` vacío o `head`. Siguieron 5 usuarios, 5 roles, 76 permisos, 3 clientes, 9 movimientos, 6 cuentas, 5 productos, 6 ofertas y 5 documentos de IA.
- El proyecto aislado `guia-entrega`, con `OPENAI_API_KEY` vacía, arrancó healthy en `127.0.0.1:18080`. Sembró 5 usuarios, 3 clientes y 5 productos. Repetir la migración dejó 5 usuarios. No se ejecutó `down -v`. Los contenedores de ese proyecto se detuvieron y sus volúmenes siguen.
- Playwright contra `127.0.0.1:8080`: acceso, cuentas y catálogo, un test cada uno, salida 0. El de cuentas debitó 1.00 MXN del volumen de demostración. El de chat no se repitió.
- Qdrant del proyecto de demostración quedó healthy con la sonda TCP nueva.
- Un 401 ya no borra la consulta que todavía está en vuelo, para que `/cuentas` sin sesión no se quede recargando.

## Archivos relevantes

| Área | Ruta |
|---|---|
| Instrucciones y fases | `AGENTS.md`, `prompts/00-inicio.md` a `prompts/07-entrega.md` |
| Contratos | `docs/01` a `docs/10`, `docs/openapi/`, `docs/contratos/`, `docs/adr/` |
| Ejecución de las fases 2 y 3 | `docs/ejecucion.md` |
| Acceso, dominio y casos de uso | `services/access/src/domain/`, `services/access/src/application/` |
| Persistencia, semilla y HTTP | `services/access/src/infrastructure/persistence/`, `services/access/src/infrastructure/http/access-handler.ts`, `services/access/src/composition/main.ts` |
| Frontend de Acceso | `apps/web/src/pages/LoginPage.tsx`, `ProfilePage.tsx`, `SessionsPage.tsx`, `UsersPage.tsx`, `RolesPage.tsx`, `AssignmentsPage.tsx`, `apps/web/src/access/http.ts`, `apps/web/src/access/webauthn.ts` |
| Cuentas | `services/accounts/src/domain/`, `services/accounts/src/application/`, `services/accounts/src/infrastructure/persistence/schema.migration.ts`, `postgres-accounts-store.ts`, `seed.ts`, `services/accounts/src/infrastructure/http/accounts-handler.ts` |
| Frontend de Cuentas | `apps/web/src/pages/HomePage.tsx`, `AccountsPage.tsx`, `MovementsPage.tsx`, `BeneficiariesPage.tsx`, `TransferPage.tsx`, `LimitsPage.tsx`, `apps/web/src/accounts/money.ts` |
| Catálogo | `services/catalog/src/domain/`, `services/catalog/src/application/`, `services/catalog/src/infrastructure/persistence/schema.migration.ts`, `postgres-catalog-store.ts`, `seed.ts`, `services/catalog/src/infrastructure/http/catalog-handler.ts` |
| Auditoría | `services/audit/src/domain/`, `services/audit/src/application/`, `services/audit/src/infrastructure/persistence/mongo-audit-store.ts`, `provision.ts`, `services/audit/src/infrastructure/messaging/audit-consumer.ts`, `services/audit/src/infrastructure/http/audit-handler.ts` |
| Frontend de Catálogo y Auditoría | `apps/web/src/pages/ProductsPage.tsx`, `OffersPage.tsx`, `CatalogAdminPage.tsx`, `AuditPage.tsx` |
| IA | `services/ai/portal_ai/`, `services/ai/prompts/`, `services/ai/eval/`, `knowledge/` |
| Frontend de IA | `apps/web/src/pages/ChatPage.tsx`, `AiAdminPage.tsx` |
| Prueba de IA | `tests/e2e/ai-chat.spec.ts`, `playwright.ai.config.ts` |
| Prueba de punta a punta | `tests/e2e/accounts-transfer.spec.ts`, `playwright.accounts.config.ts`, `tests/e2e/catalog-audit.spec.ts`, `playwright.catalog.config.ts` |
| Entorno y Compose | `compose.yaml`, `.env.example`, `infra/scripts/env-keys.mjs`, `infra/gateway/nginx.conf` |

`.env` está ignorado por Git. No se copia aquí.

## Verificación ejecutada

Resultados del 21 de octubre de 2026. El detalle de la fase 2 está en `docs/ejecucion.md`.

| Comando | Resultado |
|---|---|
| `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` en la fase 2 | Salida 0. Umbrales de cobertura de esa fase cumplidos. |
| `pnpm check:architecture` | `architecture_ok`, repetido al incorporar Acceso. |
| `docker compose --profile dev up -d --build` en la fase 2 | Salida 0. Salud de los cinco servicios. |
| `pnpm --filter @portal/access test` | 18 suites pasadas, 1 omitida, 62 tests pasados y 2 omitidos. Salida 0. Sentencias 85.85 %, ramas 74.12 %, funciones 92.36 %, líneas 85.73 %. `access-handler.ts`: ramas 58.88 %. |
| Integración `last-admin.integration.spec.ts` en un contenedor de Acceso, base `access_gate` | 2 tests pasados. El solape del candado tardó 854 ms; la revocación concurrente, 53 ms. |
| `pnpm --filter @portal/web test` | 6 suites, 18 tests, salida 0. Sentencias 86.04 %, ramas 76 %, funciones 88.33 %, líneas 86.60 %. La carpeta `src/pages` queda en ramas 68.15 %. |
| `pnpm test:e2e:access` | 1 test pasado contra `http://127.0.0.1:8080` y Mailpit. Login, perfil, sesiones, usuarios, asignaciones, roles, cierre de sesión y denegación de Ana. |
| Login, authorize y logout dentro del contenedor de Acceso | Login 200 `EMAIL_CHALLENGE`. Verificación 200 `AUTHENTICATED`. `POST /internal/v1/access/authorize` 200, `decision=allow`, `reasonCode=authorized`, con usuario y sin contraseña en el cuerpo. `users:read` presente. Logout 204. `POST http://gateway:8080/internal/v1/access/authorize` 404. |
| Lectura de `audit.events` con `rabbitmqadmin get messages` | Dos mensajes persistentes, routing key `session.revoked`, `source_service=access`. |
| `node scripts/check-architecture.mjs` tras el arreglo de `query()` | `architecture_ok`. |
| Navegador en `http://127.0.0.1:8080/entrar` y `/` | Formulario de correo y contraseña, enlaces de Google y Microsoft, y el texto de inicio sobre el buzón de prueba. El recorrido autenticado lo hizo Playwright. |
| Migración de Acceso sobre el volumen existente | `{"applied":["AccessSchema1732000000000"]}`. |
| Repetición `docker compose --profile dev run --no-deps --rm access-migrate` | `{"applied":[]}`. |
| Humo en `http://127.0.0.1:8080` | Contraseña incorrecta 401. Login del administrador de arranque: `EMAIL_CHALLENGE` sin token en el cuerpo. Verificación con el código de Mailpit: `AUTHENTICATED` y cookie de sesión. JWKS 200, una clave pública, sin componente privado. Google: 503. |
| Navegador en `/entrar` | Formulario vacío: validación. Contraseña que no es la de arranque: «Correo o contraseña incorrectos». |
| `node scripts/check-architecture.mjs` en la fase 4 | `architecture_ok`. |
| `pnpm --filter @portal/access test` tras `requireRecentVerification` | 18 suites pasadas, 1 omitida, 62 tests pasados y 2 omitidos. Salida 0. Sentencias 85.88 %, ramas 74.24 %, funciones 92.36 %, líneas 85.76 %. |
| `pnpm --filter @portal/accounts test` | 18 suites pasadas, 1 omitida en el host, 53 tests pasados y 3 omitidos. Salida 0. Sentencias 94.36 %, ramas 84.64 %, funciones 98.75 %, líneas 94.15 %. El almacén Postgres, la semilla, el publicador y el autorizador quedan fuera del porcentaje. |
| `pnpm --filter @portal/web test` | 8 suites, 26 tests, salida 0. Sentencias 85.97 %, ramas 74.35 %, funciones 90.72 %, líneas 86.17 %. |
| Integración `transfer.integration.spec.ts` en un contenedor de Cuentas, base `accounts_gate` | 3 tests pasados. Dos confirmaciones de 60.00 dejan un solo éxito y saldo 40.00. El límite diario y la repetición de clave dejan un éxito. La reautorización revocada no mueve el saldo. La propuesta vencida y la cuenta ajena se rechazan. Un publicador que lanza deja `published_at` nulo y la transferencia confirmada. |
| `docker compose --profile dev up -d --build accounts-migrate accounts access web` | Salida 0. `accounts` y `access` healthy. Migración `{"applied":["AccountsSchema1732100000000"]}`. Semilla: C-1001, C-1002, C-1003; seis aperturas; una compra; dos beneficiarios; tres límites. Nómina quedó en 24850.00. |
| `docker compose --profile dev run --no-deps --rm accounts-migrate` | `{"applied":[]}`. Los saldos no se reiniciaron. |
| `pnpm exec playwright test -c playwright.accounts.config.ts` | 1 test pasado contra `http://127.0.0.1:8080` y Mailpit. Ana vio Nómina y el beneficiario Bruno, confirmó 1.00 y el saldo bajó 1.00. Bruno recibió 403 en `/cuentas`. En Postgres, Nómina quedó 24849.00, la operativa de Bruno 15001.00, referencia `TRF9C20D7BED10B`, estado `completed`, dos movimientos `transfer`. |
| `node scripts/check-architecture.mjs` en la fase 5 | `architecture_ok`. |
| `pnpm --filter @portal/catalog typecheck` y `pnpm --filter @portal/audit typecheck` | Salida 0. |
| `pnpm --filter @portal/accounts typecheck` y `pnpm --filter @portal/accounts test` | Salida 0. 18 suites pasadas, 1 omitida, 53 tests pasados y 3 omitidos. Sentencias 94.42 %, ramas 84.80 %, funciones 98.77 %, líneas 94.21 %. |
| `pnpm --filter @portal/catalog test` con `CATALOG_GATE_DATABASE_URL` | 17 suites, 49 tests, salida 0. Sentencias 79.37 %, ramas 72.21 %, funciones 80.33 %, líneas 78.70 %. Incluye la integración en `catalog_gate`: ofertas general, por reglas y directa; la vencida no aparece; contexto no verificable oculta la de reglas; Cuentas caído responde 503; permiso ausente responde 403; el producto borrado desaparece; restaurarlo no reactiva ofertas; un publicador que lanza deja el outbox sin `published_at` y el reintento posterior lo publica. |
| `pnpm --filter @portal/audit test` con `AUDIT_GATE_MONGO_URL` | 17 suites, 41 tests, salida 0. Sentencias 91.76 %, ramas 77.39 %, funciones 88.34 %, líneas 91.40 %. Incluye Mongo `audit_gate`: dos entregas del mismo `event_id` dejan un documento; cerrar el cliente impide el insert siguiente y el documento confirmado sigue. La deduplicación, el reintento y la carta muerta también están en las pruebas de dominio sin broker. |
| `pnpm --filter @portal/web test` | 9 suites, 29 tests, salida 0. Sentencias 85.89 %, ramas 73.51 %, funciones 90.09 %, líneas 86.05 %. |
| `docker compose --profile dev up -d --build accounts catalog audit web` | Salida 0. `accounts`, `catalog` y `audit` healthy. Catálogo aplicó `CatalogSchema1732200000000` y sembró cinco productos. Auditoría creó los cinco índices. Acceso y Cuentas repitieron migración con `{"applied":[]}`. Nómina sigue en 24849.00 y la operativa de Bruno en 15001.00. |
| `pnpm exec playwright test -c playwright.catalog.config.ts` | 1 test pasado contra `http://127.0.0.1:8080` y Mailpit. Ana vio Fondo diario, Bienvenida general, Saldo ilustrativo y Seguro dirigido, y no vio Campaña vencida ni Producto retirado. `/catalogo` le respondió sin permiso. Bruno recibió 403 en `/ofertas`. Elena vio Inversión y no el enlace de Auditoría. Carla abrió Auditoría. |
| Lectura de Mongo `audit.events` y de las colas | 5 documentos, 5 `event_id` distintos: 3 `session.revoked`, 1 `transfer.completed`, 1 `audit.query`. Ninguno con `metadata.password`. `audit.events` y `audit.events.dlq` en 0. El consumidor arrancó (`audit_consumer_started`). |
| `.\.venv\Scripts\python.exe -m pytest tests -q` en `services/ai` | 28 pasados. Salida 0. Cobertura total 76.22 %. Composición, persistencia, clientes y Qdrant quedan fuera del porcentaje. |
| `pnpm --filter @portal/access test` | 18 suites pasadas, 1 omitida, 62 tests pasados y 2 omitidos. Sentencias 86 %, ramas 74.48 %, funciones 92.41 %, líneas 85.87 %. |
| `pnpm --filter @portal/web test` | 10 suites, 31 tests, salida 0. Sentencias 84.79 %, ramas 71.97 %, funciones 87.59 %, líneas 84.92 %. `src/pages` queda en ramas 68.41 %. |
| `node scripts/check-architecture.mjs` | `architecture_ok`. |
| `python eval/run_eval.py` en `services/ai` | `{"dataset":"v1","promptVersion":"v1","mode":"not_run","cases":10,"latencyP50Ms":null,"latencyP95Ms":null,"meanCostUsd":null,"totalCostUsd":null}`. |
| `docker compose --profile dev up -d --build ai-migrate ai access web gateway` | Salida 0. `ai-migrate` imprimió `{"applied":"head"}`. `ai` quedó healthy. No se ejecutó `docker compose down -v`. |
| `GET /v1/models/gpt-6-luna` desde el contenedor de IA | 200. El identificador devuelto fue `gpt-6-luna`. La plantilla y el ADR usan ese modelo. |
| Indexación al arrancar | Cinco trabajos `completed`, costes 0.000005, 0.000003, 0.000005, 0.00001 y 0.000009 USD, `usage_complete=true`. Qdrant `knowledge`: 8 puntos. Seis reglas de alerta. |
| `pnpm exec playwright test -c playwright.ai.config.ts` | 1 test pasado contra `http://127.0.0.1:8080` y Mailpit. Ana abrió el asistente, envió un mensaje y no apareció el botón de confirmar. `/ia` le respondió sin permiso. Diego abrió Métricas y alertas y no vio el mensaje de Ana. |
| Lectura de `ai_records` y de Mongo `events` tras ese recorrido | La ejecución que cerró el recorrido quedó `completed`, modelo `gpt-6-luna`, 4237 tokens de entrada, 351 de salida, 6 pasos, coste estimado 0.05992 USD, medición completa. Outbox `ai.run.completed` con `published_at`. Mongo tiene 1 `ai.run.completed` y 3 `ai.run.failed`. Ningún evento de auditoría tiene `metadata.password`. |

## Fallos, bloqueos e integraciones no verificadas

- La etiqueta `qdrant/qdrant:1.15.4` no existe. Se usa `qdrant/qdrant:v1.19.2-unprivileged`.
- Un arranque de Acceso falló con `Cannot find module 'express'` porque el import directo no se resuelve en la imagen con pnpm. El cuerpo JSON se lee en `composition/main.ts` sin añadir `express` como dependencia directa. Tras reconstruir, el servicio quedó healthy.
- Una espera a `/services/access/ready` se colgó mientras el contenedor estaba unhealthy y devolvió 502. No es el estado actual.
- Google y Microsoft no tienen credenciales. No hay smoke real de OIDC. OpenAI y LangSmith se detallan en la fase 6.
- WebAuthn tiene RP `localhost` y origen `http://localhost:8080`. La ceremonia no se ejecutó. Habilitar la política en un usuario de arranque revocaría su sesión y cambiaría el segundo factor del volumen de demostración.
- La sonda SMTP comprueba TCP hacia Mailpit. El login de Acceso sí envió y leyó un correo en ese buzón. No hubo correo a un destinatario externo.
- En la fase 4 la cola `audit.events` conservaba `session.revoked` porque Auditoría no consumía. En la fase 5 el consumidor vació esa cola. En la fase 6 Mongo sumó 1 `ai.run.completed` y 3 `ai.run.failed`. Ninguno tiene `metadata.password`.
- El almacén Postgres y los adaptadores criptográficos siguen fuera del porcentaje, igual que las fábricas de la fase 2. El manejador HTTP sí entra. Su archivo queda bajo el 70 % en ramas; el agregado del servicio no.
- Quedó la base aislada `access_gate` en el Postgres de Compose, dueña `access`. No se ejecutó `DROP DATABASE` ni `docker compose down -v`.
- OpenAPI define `AuthStep` sin el campo `options`. La respuesta de opciones de passkey de login incluye `options` porque la ceremonia no puede continuar sin ellas. El archivo OpenAPI no se modificó.
- Quedó la base aislada `accounts_gate`, dueña `accounts`, junto a `access_gate`. No se ejecutó `DROP DATABASE` ni `docker compose down -v`.
- La carrera de dos confirmaciones, la clave repetida, la sesión revocada dentro de la transacción y la propuesta vencida se comprobaron en `accounts_gate`. No se repitieron contra el volumen de demostración.
- El e2e obtuvo el comprobante en la respuesta. No se observó en el gateway un timeout ni un 503 de confirmación. El estado incierto está cubierto por la prueba de `TransferPage`, no por ese recorrido.
- `outbox_events` de la transferencia de demostración tenía `published_at`. En la fase 5 ese `transfer.completed` quedó persistido en Mongo. No se volvió a leer el cuerpo.
- Entre la segunda autorización y el commit, una revocación en Acceso no es atómica con Cuentas. Si la segunda llamada niega, la transacción revierte y la propuesta sigue pendiente.
- El tope de resolución de destinatario es provisional: 20 intentos en 60 segundos (`RESOLVE_RATE_LIMIT`, `RESOLVE_RATE_WINDOW`).
- Cada ejecución del e2e de Cuentas debita 1.00 MXN del volumen de demostración. Esta corrida lo hizo una vez.
- No se abrió el navegador del IDE. El recorrido de la interfaz lo hizo Playwright.
- Quedaron las bases aisladas `catalog_gate`, dueña `catalog`, y `audit_gate` en Mongo. No se ejecutó `DROP DATABASE` ni `docker compose down -v`. Los reenvíos temporales de puerto se eliminaron al terminar.
- El almacén Postgres de Catálogo, el almacén Mongo, las semillas, la composición y el bucle de `amqplib` quedan fuera del porcentaje. Los manejadores HTTP y los clientes de servicio sí entran. `catalog-handler.ts` queda en ramas 42.15 %; el agregado del servicio no baja de 70 %.
- La semilla de Catálogo inserta filas por SQL y no escribe outbox. El e2e solo consultó. En el volumen de demostración `outbox_events` de Catálogo tiene 0 filas. La publicación fallida y el reintento se comprobaron en `catalog_gate`, no contra Rabbit del Compose.
- No se detuvo Mongo ni Rabbit del Compose. La caída de Mongo se simuló cerrando el cliente de `audit_gate`. La carta muerta y el reproceso se comprobaron en memoria. `reprocessDeadLetters` no se invocó sobre `audit.events.dlq`, que estaba en 0.
- No se ejecutó `pnpm lint` ni `pnpm test` de todo el repositorio en esta fase.
- Un `UPDATE ... RETURNING` de TypeORM devuelve `[filas, conteo]`. El almacén de Catálogo ahora separa las filas, igual que Cuentas. Sin eso, borrar un producto intentaba guardar un UUID `undefined`.
- La cobertura de ramas de `envelope.ts` queda en 60.29 %. El agregado de Auditoría está por encima del 70 %. No se ejercieron en vivo todos los tipos de evento del sobre.
- Google, Microsoft, OpenAI y LangSmith no tenían credenciales en el cierre de la fase 5. En la fase 6 el `.env` local sí tiene clave de OpenAI y de LangSmith. `LANGSMITH_TRACING=false`. No se forzó una traza con el servicio caído ni apagado más allá de las pruebas con un cliente falso.
- La plantilla, el ADR y el `.env` local usan `gpt-6-luna`. Las herramientas usan la Responses API, sin herramientas alojadas. Los costes ya registrados en esa fase se calcularon con la tabla anterior de 10, 1, 12.50 y 50 USD por millón. La tabla vigente es 0.10, 0.01, 0.125 y 0.50.
- Antes de devolver al modelo el resultado de la herramienta, dos ejecuciones reales agotaron los 8 pasos: costes 0.03915 y 0.03787 USD, medición completa. Una ejecución anterior falló con `unavailable` y el coste quedó null. No se muestra como cero. Esas tres quedaron en Mongo como `ai.run.failed`.
- La evaluación versionada de 10 casos no se ejecutó contra el proveedor. `eval/run_eval.py` no llama al modelo aunque `AI_EVAL_REAL=true`; deja el modo pendiente. No hay p50, p95 ni coste medio reales de ese conjunto.
- Los avisos del 80 % y del 100 % no se dispararon: el coste observado está por debajo de 0.80 USD. No se comprobó en vivo el correo de Mailpit para una alerta. La deduplicación y el directorio de administradores sí están en las pruebas unitarias.
- No se confirmó ninguna transferencia en esta fase. Los saldos de la demostración no se debitaron por el chat.
- `conversations.py` y `chat_routes.py` quedan por debajo del 70 % en el detalle. El agregado de IA no. Composición, persistencia, clientes y el adaptador de Qdrant están omitidos del porcentaje; la indexación viva sí escribió en Qdrant.
- No se abrió el navegador del IDE. El recorrido de chat y del panel lo hizo Playwright.

## Decisiones de implementación

- TypeScript quedó en 6.0.3. La 7 no cumple el peer de `typescript-eslint` 8.72.0 ni el de `ts-jest` 29.4.15. `ioredis` quedó en 5.11.1 por el peer de TypeORM.
- La contraseña se hashea con `hash-wasm` Argon2id para no compilar nativo dentro de la imagen slim.
- El access token de usuario es RS256. La clave privada se guarda cifrada. `JWT_SIGNING_KEY` no se publica en JWKS. El JWT de servicio es HS256, audiencia `access.authorize`.
- Cookies `portal_session` y `portal_refresh` HttpOnly. `portal_csrf` la lee la SPA para enviarla en `X-CSRF-Token`. `Secure` solo si el protocolo es HTTPS. En el gateway local, HTTP, `Secure` queda apagado.
- El login no crea sesión plena. Con passkey deshabilitada, el segundo factor es el código de correo. La recuperación administrativa permanece deshabilitada y responde 422.
- Administrador efectivo: asignación activa del permiso `users:roles:assign`. El bloqueo del último administrador va dentro de la transacción.
- OIDC no vincula por correo. Sin credenciales, la operación responde 503.
- Los límites de tasa de login (8 por cuenta y 30 por IP en 900 s, 3 reenvíos) son provisionales y configurables. No son requisitos del PDF.
- Redis guarda la caché de permisos por versión de autorización. La vigencia de la sesión se lee en Postgres.
- La semilla crea la aplicación `portal`, los cinco roles de sistema y los cinco usuarios locales. No inventa passkeys ni identidades externas. Si falta la contraseña de arranque, no crea contraseña y registra `bootstrap_password_missing` sin el secreto. Repetir la semilla no rota una contraseña ya existente.
- Cuentas identifica al usuario con el mismo UUID determinista que Acceso (`sha256` de `portal:` más el nombre). No consulta tablas de Acceso.
- El día operativo se calcula con `Intl` y `America/Mexico_City`. Cualquier otra zona en `FINANCIAL_TIME_ZONE` detiene el arranque.
- La propuesta no reserva fondos. Su etiqueta de destino es una foto del titular y de la cuenta enmascarada. Confirmar exige cuerpo vacío, `Idempotency-Key` y verificación reciente. Una segunda clave sobre una propuesta ya confirmada responde 409 y no crea otra transferencia.
- Los límites de demostración siguen los valores de entorno: 10000.00 por transferencia y 10000.00 diarios, con techos 50000.00 y 100000.00. Son configurables.
- Catálogo compara `totalBalance` en centavos y `accountAgeDays` como entero. Un valor de regla ilegible no cumple la regla. La audiencia por reglas exige todas las condiciones. La semilla usa `totalBalance` mayor o igual a 20000.00; Ana califica y Bruno no.
- La consulta de auditoría usa `AUDIT_RANGE_MAX_DAYS`, por defecto 31. Un rango mayor responde validación. La zona mostrada en la UI es `America/Mexico_City`; el API guarda UTC.
- El consumidor de Auditoría no publica. Confirmar un duplicado también es ack. Los reintentos de un fallo de Mongo ocurren en el mismo proceso, porque el usuario `audit` de Rabbit no puede republicar.
- El asistente prepara, no confirma. El esquema que se envía al proveedor marca todos los campos como requeridos y convierte los opcionales en null, porque el modo estricto lo exige. La validación de dominio sigue rechazando un argumento incompleto.
- Las tarifas de chat y de embeddings salen de `OPENAI_PRICE_*`, versión `openai-2026-10-21` si no se cambia la fecha. Para `gpt-6-luna` la plantilla usa 0.10, 0.01, 0.125 y 0.50 USD por millón. Un campo de uso desconocido anula el coste. El coste de indexación no entra en el agregado del chat.
- Los umbrales de aviso iniciales son 0.80 y 1.00 USD por ejecución, 4.00 y 5.00 por usuario y día, 20.00 y 25.00 globales. Son configurables con `PUT` de reglas. Los destinatarios vacíos se resuelven en Acceso entre quienes tienen `ai:alerts:read`.

## Próximo paso

La fase 7 queda cerrada con los límites del informe final. No hay otra fase de implementación. Las integraciones que faltan requieren la configuración pedida en `docs/informe-final.md`.
