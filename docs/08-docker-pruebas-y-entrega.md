# Repositorio, Docker, pruebas y entrega

## Estructura objetivo

| Ruta | Uso |
|---|---|
| apps/web | React |
| services/access, accounts, catalog, audit | NestJS independientes |
| services/ai | FastAPI |
| packages/contracts | Eventos/esquemas publicados, no entidades compartidas |
| packages/ts-config | Configuración técnica común |
| infra | Proxy, DB bootstrap, broker y correo local |
| knowledge | Documentos RAG aprobados |
| tests/e2e | Recorridos transversales |
| docs | Arquitectura, ADR, contratos y runbooks |
| compose.yaml | Entorno completo |
| .env.example | Variables sin secretos |

Dentro de servicio: domain, application, infrastructure, presentation y composition.
Python usa nombres convencionales equivalentes. Controllers delgados.
Frontend por módulos funcionales; no reutilizar DTO ORM como modelo UI.
Un workspace TS (p. ej. pnpm) con lockfile; Python lockfile propio. Elegir una herramienta y documentar.
Build independiente por servicio; cambios a un servicio no requieren desplegar todo.
Paquetes compartidos no importan dominios concretos.

## Compose

Servicios de app: access, accounts, catalog, audit, ai, web.
Infra: gateway, postgres, mongo, redis, rabbitmq, qdrant, mailpit.
Postgres un contenedor local con bases/usuarios distintos para cuatro servicios; aislamiento mediante permisos.
Worker outbox/alertas/indexación puede usar imagen del servicio en comando distinto.
No sumar workers o DBs al conteo de microservicios de negocio.
Volúmenes para datos; pruebas con volúmenes aislados.
Solo entrada web expuesta por defecto; consolas/correo en localhost mediante perfil de desarrollo.
Healthchecks y dependencias saludables; retries runtime, no confiar solo en orden inicial.
Migraciones como jobs una sola ejecución por servicio; arranque espera éxito.
Bootstrap de DB idempotente y probado tanto con volumen nuevo como existente.
Seeds explícitos, idempotentes y separados de migraciones.
Sin synchronize=true para crear esquema en ejecución.
Índices Mongo/Qdrant gestionados por provisión versionada idempotente.

Dockerfiles multistage y no root cuando aplique. Contextos mínimos, .dockerignore,
versiones fijadas, sin secretos en layers ni build args públicos.
Frontend build servido por servidor estático/proxy, no Vite dev en modo aplicación.
Deep links SPA sirven index correctamente; APIs no devuelven HTML para ocultar 404.
Credenciales locales individuales y ejemplo de generación, no password universal en Git.
Puertos DB internos por defecto; red y usuario por necesidad.
No Redis eviction que elimine estado crítico sin política; permisos cache prescindible separados de sesión authoritative.

## Variables e integración externa

.env.example: URLs internas/externas, DB por servicio, broker, Redis, JWKS/issuer/audience,
sesión/OTP/recuperación, WebAuthn RP ID/origin, Google/Microsoft, SMTP,
límites, OpenAI/modelos/precios, Qdrant, alertas, LangSmith opcional.
Validar al iniciar y fallar con error seguro; no imprimir valores secretos.
VITE_* solo público.
Localhost WebAuthn según soporte navegador; entornos no localhost HTTPS y RP ID estable.
Callbacks OIDC coinciden con URLs registradas, no host interno Docker.
Correo local capturado sin envío externo.
Modo real OpenAI/OIDC requiere credenciales. Simulación solo perfil explícito de tests, etiquetada; no reemplazar demo real silenciosamente.

Comandos finales documentados y realmente ejecutados:
- instalar dependencias;
- build y typecheck/lint;
- iniciar infraestructura y migraciones;
- cargar demo;
- iniciar app / consultar salud;
- indexar knowledge;
- unitarios, integración, e2e y evaluación;
- detener sin borrar datos;
- limpieza destructiva solo explícita y advertida.
No inventar scripts: crearlos y verificar sus nombres en entrega.

## Tests

Por servicio >=70% en líneas, ramas, funciones y sentencias de código propio comprobable donde la herramienta permita.
Objetivo interno más explícito que el mínimo del PDF; documentar métricas y justificar cualquier ajuste.
Exclusiones solo generado/config/bootstrap/migraciones justificadas, nunca dominio por conveniencia.
Informe HTML + lcov para TS y HTML/XML para Python, generados por ejecución.
Frontend: Jest + RTL, flujos/estados; e2e Playwright.
Integración con PostgreSQL/Mongo/Redis/Rabbit/Qdrant reales aislados según riesgo, no todo mocks.
HTTP terceros/OIDC/WebAuthn con fixtures controladas + smoke real opcional separado.
No escribir tests que solo copien implementación.

Casos críticos:
- Acceso válido, OTP expirado/reusado, alta/passkey/recovery, refresh reutilizado.
- Revocación después de cambio de rol/asignación y rol con muchos usuarios.
- No autoelevación; no último admin eliminado; restauración no reactiva accesos.
- Cuenta ajena, saldo insuficiente, monto inválido y límites.
- Simultáneas, idempotencia en carrera, una propuesta con claves distintas.
- Reinicio entre commit/publicación outbox; auditoría duplicada; broker/Mongo caídos.
- Ofertas por reglas y dependencia de elegibilidad caída.
- Chat RAG con fuentes, permisos, confirmación y sesión revocada.
- Costes incompletos, múltiples llamadas, alertas duplicadas, solo admins.
- LangSmith apagado, caído y redacción de subtrazas.
- URL/scroll, cambio de usuario, UI teclado, temas y deep links.
Arquitectura: imports prohibidos, dominio sin framework y no entidades compartidas.

## Gates por fase

1 Arquitectura: mapa de contextos, ADRs, contratos, DDD/seguridad; sin implementación masiva.
2 Base: build/health/migraciones/Docker verificables y arquitectura comprobada.
3 Acceso: auth/RBAC/SSO/passkeys y pantallas; revocación verificada.
4 Cuentas: flujo de transferencia UI completo y pruebas de consistencia.
5 Auditoría/Catálogo: entrega de eventos y consulta elegible/pantallas.
6 IA: RAG/tools/UI/métricas/alertas y LangSmith opcional.
7 Entrega: clean startup, tests/cobertura, e2e, docs/diagnóstico y evidencia.

## Entregables de implementación

README de ejecución y limitaciones; Mermaid y ADRs; OpenAPI por servicio; contratos de eventos;
Dockerfiles/Compose; migraciones/seeds; tests e informes; evaluación IA;
documentación prompts/RAG/costes; matriz permisos; diagnóstico y comunicación;
evidencia de comandos con resultados reales.
Separar implementado, probado y pendiente. No capturas o informes ficticios.
