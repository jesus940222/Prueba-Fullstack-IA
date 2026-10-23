# Fase 2: base ejecutable y Docker

Lee AGENTS.md, docs/ y resultados de fase 1. Implementa solo la base transversal.

- Monorepo con frontend, cinco servicios, configuración TS y contratos, sin entidades compartidas.
- NestJS con domain/application/infrastructure/presentation/composition; Python equivalente.
- Dominio sin frameworks. Agregar regla automatizada de imports prohibidos.
- Fijar versiones compatibles y lockfiles desde docs oficiales; HeroUI v3 real, no API v2.
- Dockerfile multistage por servicio/frontend; Compose con PostgreSQL separado por DB/usuario,
  MongoDB, Redis, RabbitMQ, Qdrant, proxy y buzón SMTP local.
- Health/readiness honestos, timeouts/retries de infraestructura, logs JSON y correlation_id.
- Migraciones mediante jobs exclusivos y bootstrap DB idempotente; no synchronize=true.
- Provisión de índices, colas y dead-letter exchange/queue idempotentes.
- .env.example validado; no secretos reales ni VITE_* sensibles.
- Perfiles desarrollo/pruebas; volúmenes aislados de datos de demo.
- Frontend shell responsive con HeroUI, Router, Zustand, Query, RHF/Zod y tema.
- Configurar Jest/RTL/Playwright y tests backend/Python; scripts consistentes.

No crear endpoints ficticios con éxito si su funcionalidad no existe.
Si faltan credenciales externas, estado degradado/capacidad indisponible documentado; no mock silencioso.
No bloquear toda infraestructura local por falta de Google/OpenAI para ejecutar tests controlados.

Gate:
build, typecheck/lint, import rules, tests básicos significativos, Compose válido,
arranque/health y migraciones tanto con DB nueva como existente.
No afirmar Docker verificado si no hay daemon: validar lo posible y registrar gate bloqueado.
No hacer limpieza destructiva de volúmenes ajenos o preexistentes.

Entrega comandos realmente ejecutados y resultados. No avanzar a fase 3 con bloqueo material oculto.
