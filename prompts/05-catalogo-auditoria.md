# Fase 5: Catálogo y Auditoría

Implementa ambos contextos con independencia y sus pantallas.

Catálogo:
- PostgreSQL/TypeORM, categorías, productos/atributos JSONB tipados, ofertas y reglas allowlist.
- Audiencias general/rules/direct, fechas/vigencia y asignaciones.
- Contexto de Cuentas mediante API interna autenticada, no DB compartida.
- Falta de contexto no concede elegibilidad; respuesta tipada.
- Consulta clientes solo productos/ofertas, sin interés ni contratación.
- CRUD administrativo y restauración con permisos, scopes y borrado lógico.
- Rol personalizado gestor de catálogo, sin ampliar administrador de accesos.
- Cambios generan outbox y versionado de términos.

Auditoría:
- MongoDB anexado, índices por event_id/correlación/fecha/actor/tipo.
- Rabbit consumidor con schemas, deduplicación, ack tras persistencia, retry y DLQ.
- Productores autenticados y payload mínimo/redactado.
- GET por páginas/filtros/scopes, sin endpoints de modificación.
- Auditar consultas sin bucle infinito; no almacenar secretos/transcripciones.
- UI de eventos con correlación, estados y zona México.

Gate:
Elegibilidad general/reglas/directa, vencimiento y dependencia caída.
Productos borrados no aparecen; restaurar no activa ofertas anteriores.
Evento duplicado produce una fila; Mongo/Broker caídos no pierden eventos confirmados.
DLQ recuperable y reproceso sin duplicados.
Autorización y límites de consulta con tests negativos.
Unitarios/integración/e2e, cobertura por servicio >=70% y reportes reales.
