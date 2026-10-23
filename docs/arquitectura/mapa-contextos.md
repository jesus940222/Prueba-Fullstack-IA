# Mapa de contextos

Diseño de la fase 1. No describe un sistema en ejecución.

La aplicación de demostración tiene cinco bounded contexts. Auth, usuarios y roles del PDF viven en Acceso: separarlos en servicios que comparten el mismo agregado de identidad produciría un monolito repartido. Cuentas y Catálogo son ampliaciones acordadas, no requisitos literales del PDF.

| Contexto | Responsabilidad | Datos de los que es dueño | No posee |
|---|---|---|---|
| Acceso | Identidad, credenciales, OIDC, sesiones, RBAC y delegación | PostgreSQL `access`; Redis solo como caché de permisos por versión | Clientes, saldos, productos, eventos de auditoría, chats |
| Cuentas | Clientes, cuentas, beneficiarios, límites y transferencias MXN | PostgreSQL `accounts` | Usuarios, roles, catálogo, vectores |
| Catálogo | Categorías, productos, ofertas, reglas y asignaciones | PostgreSQL `catalog` | Saldos y tablas de Cuentas; la elegibilidad se pide por API |
| Auditoría | Recepción y consulta de eventos | MongoDB `audit` | El estado de negocio que originó el evento |
| IA | Conversación, RAG, ejecuciones, coste y alertas | PostgreSQL `ai`, Qdrant `knowledge`, checkpoints propios | Tablas de los otros servicios y la decisión de transferir |

## Comunicación

- Personas y navegador hablan con un proxy de mismo origen. No hay BFF ni gateway de políticas.
- `/internal/v1/**` no se publica en ese proxy. Lo usan solo la red interna y una credencial de servicio por llamante.
- El permiso se decide en Acceso. Cuentas decide y ejecuta el dinero. El modelo solo prepara.
- RabbitMQ transporta hechos ya confirmados. No es el mecanismo de revocación ni de débito/crédito.
- Una referencia entre servicios es un UUID, nunca una clave foránea entre bases.

## Dueño de cada flujo

| Flujo | Reglas y datos | Si la dependencia falla |
|---|---|---|
| Login, SSO y passkey | Acceso | No hay sesión. OIDC o correo caídos responden 503. Un fallo de passkey no baja a correo. |
| Cambio de permisos | Acceso, en una transacción local | La revocación confirmada queda en PostgreSQL aunque Redis falle. Quien no pueda autorizar recibe 503. |
| Transferencia | Cuentas, en una transacción local | Si Acceso no responde, no hay débito. El broker puede caer después del commit; el outbox reintenta. |
| Elegibilidad de oferta | Catálogo con contexto mínimo de Cuentas | Contexto no verificable: no se concede la oferta. |
| Auditoría | Auditoría, después de persistir | No se confirma el mensaje. Reintento y luego DLQ. La consulta no se publica otra vez al broker. |
| Chat y RAG | IA orquesta; Cuentas o Catálogo responden | Proveedor o presupuesto agotado: la ejecución falla y no hay transferencia. La confirmación entra por la UI a Cuentas. |

Los diagramas están en `docs/arquitectura.mmd`, `docs/eventos.mmd` y `docs/flujos/`. El relato de fallo está en `docs/arquitectura/flujos.md`.
