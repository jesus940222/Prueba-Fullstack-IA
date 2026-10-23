# ADR 0002. Aislamiento de datos y servicios

- Estado: aceptado el 21 de octubre de 2026.

## Decisión

Hay cinco servicios desplegables, cada uno con su Dockerfile. PostgreSQL local es un solo contenedor con las bases `access`, `accounts`, `catalog` y `ai`, y una credencial distinta por base. Eso conserva el aislamiento pedido sin presentar cuatro motores como cuatro microservicios. Auditoría no comparte ese motor: usa MongoDB.

Redis no guarda sesiones ni refresh. Solo cachea permisos prescindibles, con clave que incluye la versión de autorización. Su política de desalojo no puede borrar el registro de sesiones porque ese registro no está allí.

Qdrant solo lo usa IA. La colección `knowledge` usa 3072 dimensiones, el valor por defecto de `text-embedding-3-large`. Cambiar dimensiones exige otra colección y una reindexación, no un ajuste silencioso.

RabbitMQ tiene el exchange `portal.events`, la cola `audit.events` y la DLQ `audit.events.dlq`. El publicador pertenece al servicio que escribió el outbox. No se añade un sexto microservicio de integración.

El proxy público enruta `/api/v1/access`, `/api/v1/accounts`, `/api/v1/catalog`, `/api/v1/audit` y `/api/v1/ai`. Quita cabeceras `X-User-Id` y cualquier rol entrante. No enruta `/internal/v1`. Las rutas internas autentican al servicio llamante con credencial propia, audiencia mínima y rotación. Una credencial de servicio no autoriza una transferencia ilimitada: la operación de usuario sigue exigiendo sesión y permiso.

MongoDB tiene dos usuarios. `audit_consumer` solo inserta. `audit_api` lee e inserta el evento de la propia consulta. Ninguno actualiza ni borra.

## Consecuencias

No hay tablas compartidas, esquemas cruzados ni entidades de negocio importadas entre servicios. `packages/contracts` solo lleva contratos publicados. La fase 2 debe probar el bootstrap con volumen nuevo y con volumen ya existente, sin `synchronize=true`.
