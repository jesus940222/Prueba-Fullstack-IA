# Trazabilidad contra la prueba técnica

Fuente: PDF "Prueba_Tecnica_Desarrollador_Fullstack IA.pdf", siete páginas, leído en la fase 1.
El PDF no está en este repositorio. El encabezado interno del PDF dice `Prueba_Tecnica_Desarrollador_Backend.md` y la suma de ejercicios es 420 minutos, mientras el total impreso dice 4.25 horas.

Estados de esta entrega: implementado, verificado, parcial o pendiente. Verificado exige una ejecución de esta fase o una prueba automática que sigue en el repositorio y se volvió a ejecutar el 21 de octubre de 2026. El detalle de comandos está en `docs/informe-final.md`.

| Ejercicio / requisito | Estado | Evidencia |
|---|---|---|
| 1: 3-4 microservicios | Verificado | Cinco servicios en Compose. Salud de Acceso, Cuentas, Catálogo, Auditoría e IA en `http://127.0.0.1:8080/services/*/ready`. |
| 1: diagrama y justificación | Implementado | `docs/arquitectura.mmd`, `docs/flujos/` y ADRs 0001 a 0007. El diagrama no se redibujó: los cinco contextos siguen siendo los que arrancan. |
| 1: DDD y Clean Architecture | Verificado | `node scripts/check-architecture.mjs` imprimió `architecture_ok`. El dominio no importa Nest, TypeORM, FastAPI, SQLAlchemy ni LangGraph. Los casos de uso no importan infraestructura. |
| 1: varias bases | Verificado | Postgres `access`, `accounts`, `catalog` y `ai`; Mongo `audit`; Redis; Qdrant. Cada uno con credencial propia. No hay consultas cruzadas de tablas. |
| 1: REST y asíncrono | Verificado | OpenAPI en `docs/openapi/`. Outbox y consumidor de Auditoría. Repetir migraciones devolvió `applied` vacío y los conteos no cambiaron. |
| 1: resiliencia | Parcial | Readiness por dependencia, outbox si el broker falla y 503 si Cuentas no responde a Catálogo. Esos fallos están en pruebas de servicio. No se apagó el broker del volumen de demostración. |
| 2: servicios independientes | Verificado | Imagen y Dockerfile por servicio. `pnpm build` compiló cada paquete. |
| 2: OAuth2/OIDC y JWT | Parcial | JWKS público sin material privado. Google, con credenciales presentes, respondió 302 hacia `accounts.google.com`. El callback con una cuenta real no se completó. Microsoft no arranca sin emisores explícitos. |
| 2: ORM | Verificado | TypeORM, Mongoose y SQLAlchemy detrás de almacenes. `synchronize` no está activo. Las entidades de dominio no son respuestas HTTP. |
| 2: Docker Compose | Verificado | `docker compose --profile dev` deja el gateway en `127.0.0.1:8080`. Las bases no publican puerto. |
| 2: cobertura mínima 70 % | Verificado | Agregados de Acceso, Cuentas, Catálogo, Auditoría, web e IA por encima del 70 % en sentencias, ramas, funciones y líneas del código incluido. Informes en cada servicio. Exclusiones de composición, semillas y almacenes de infraestructura documentadas en el informe. |
| 2: logs JSON y controles OWASP | Parcial | Los servicios escriben JSON con timestamp, nivel, servicio, evento y correlation id. Hay pruebas de denegación, CSRF, revocación y recursos ajenos. No hay un recolector central ni una auditoría OWASP externa. |
| 3: React, TypeScript y estado | Verificado | HeroUI 3.2.6, React Router, TanStack Query, Zustand, React Hook Form y Zod. `pnpm --filter @portal/web test` pasó. |
| 3: carga, error y formularios | Verificado | Las pantallas de negocio cubren carga, vacío y error en pruebas de componente. Las rutas internas del gateway devolvieron el HTML de la SPA. `/api/v1/missing` devolvió JSON 404. |
| 3: Jest, RTL y Docker | Verificado | Jest 30 y Playwright. Los recorridos e2e apuntan al gateway, no a capturas. |
| 4: diagnóstico | Implementado | Runbook en `docs/09-diagnostico.md`. Respuesta del ejercicio en `docs/diagnostico-respuesta.md`. No hubo un incidente real de producción. |
| 4: coste, latencia y límite de IA | Parcial | Una ejecución real anterior midió tokens y coste. Las reglas de aviso no se dispararon porque el coste quedó bajo 0.80 USD. El conjunto de evaluación no se ejecutó contra el proveedor. |
| 4: comunicación | Implementado | Plantilla aplicada al ejercicio, separada de una comunicación de un incidente real. |
| 5: agente | Verificado | LangGraph prepara. La confirmación de transferencia no es una herramienta. El e2e de la fase 6 no mostró el botón de confirmar dentro del chat. |
| 5: RAG | Parcial | Cinco documentos de `knowledge/` indexados en Qdrant `knowledge`. Un documento administrativo no entra en la audiencia general. No se repitió la indexación en esta fase más allá del arranque ya registrado. |
| 5: prompts | Implementado | `services/ai/prompts/system-v1.md` y `few-shot-v1.json`. No se guarda el razonamiento interno. |
| 5: calidad y coste del dataset | Pendiente | `eval/run_eval.py` imprime `mode=not_run` y no llama al modelo aunque exista clave. No hay p50, p95 ni coste de ese conjunto. |
| 5: errores y límites del agente | Parcial | Topes de pasos, tokens, tiempo y presupuesto están en código y en pruebas con proveedor controlado. LangSmith está apagado. No se forzó una exportación real. |

## Ampliaciones acordadas

Portal financiero y transferencias, SSO, passkeys por usuario, roles dinámicos, borrado lógico, beneficiarios, métricas visibles, alertas y LangSmith opcional. No son requisitos literales adicionales del PDF.

Passkeys: el servidor y la pantalla existen. La ceremonia con un autenticador no se ejecutó. Queda parcial.

Transferencias simultáneas, idempotencia y saldo: verificadas en la base aislada `accounts_gate` durante la fase 4 y cubiertas por las pruebas de dominio que volvieron a pasar. Esta fase no repitió la carrera contra el volumen de demostración. El e2e de cuentas, cuando se ejecuta, debita 1.00 MXN de ese volumen.

## Referencias

Las mismas de la fase 1. No sustituyen el PDF. La guía de tema de HeroUI v3 sustituye la URL que respondió 404.
