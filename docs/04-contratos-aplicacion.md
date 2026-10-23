# Contratos de aplicación e integración

## Convenciones comunes

APIs /api/v1 por servicio, UUID, ISO UTC, strings decimales y moneda explícita.
Errores: code estable, message seguro, correlation_id y field_errors opcionales.
401 sesión inválida/revocada; 403 permiso/titularidad denegados; 404 recurso no visible; 409 conflicto/idempotencia;
422 validación de negocio/transporte según contrato uniforme; 429 rate limit; 503 dependencia no verificable.
No revelar existencia ajena mediante diferencias innecesarias de error.
Nunca devolver stacktrace, SQL, configuración o respuesta cruda del proveedor.
Éxitos: objeto tipado o lista paginada, sin envoltorios distintos en cada servicio.
Correlación validada/generada por backend; propagar W3C trace context si se implementa.

Páginas: page>=1, pageSize<=100; respuesta items,totalItems,totalPages,page,pageSize.
Cursor: limit<=50, cursor opaco validado y ligado a filtros; items,nextCursor,hasMore.
Valores por defecto: 20. Orden estable con ID de desempate.
Filtros/ordenamiento permitidos por esquema; autorización antes de filtrar/contar.
Describir comportamiento para page fuera de rango (items vacío) y cursor inválido (error validación).
No prometer snapshot consistente entre páginas si no existe; cursores documentan semántica ante altas/bajas.

## Cuentas: /api/v1/accounts

| Método | Ruta relativa | Permiso |
|---|---|---|
| GET | /summary | accounts:read:own |
| GET | /accounts y /accounts/:id | accounts:read:own |
| GET | /accounts/:id/movements | transactions:read:own |
| GET | /transfers y /transfers/:id | transfers:read:own |
| GET | /transfers/:id/receipt | transfers:read:own |
| GET | /beneficiaries | beneficiaries:read:own; cursor + search |
| POST | /beneficiaries | beneficiaries:create:own |
| PATCH | /beneficiaries/:id | beneficiaries:update:own; alias |
| DELETE | /beneficiaries/:id | beneficiaries:delete:own; lógico |
| POST | /recipients/resolve | transfers:create:own; mínimos datos y rate limit |
| POST | /transfer-proposals | transfers:create:own |
| GET | /transfer-proposals/:id | transfers:create:own; propietario/sesión |
| DELETE | /transfer-proposals/:id | transfers:create:own; cancelar pendiente |
| POST | /transfer-proposals/:id/confirm | transfers:create:own + confirmación/recencia |
| GET | /me/transfer-limits | transfer-limits:read:own |
| PATCH | /me/transfer-limits | transfer-limits:update:own + verificación reciente |

Preparación: source_account_id, beneficiary_id XOR destination_account_number, amount, currency, concept.
Respuesta: id, valores validados/inmutables, destinatario mínimo, vencimiento y estado.
Confirmación: Idempotency-Key obligatoria; no acepta cambios de datos.
Sesión/usuario/permiso vigentes, cuenta activa propia, destino activo distinto, moneda, saldo, límites y concurrencia.
Verificar autorización otra vez al ejecutar; no reutilizar autorización del momento de preparación.
Reintento incierto: consultar propuesta/operación o repetir misma clave, nunca nueva operación ciega.
Guardar beneficiario como operación separada explícita.
Resumen de gastos con criterios definidos; transferencias no son gasto comercial automáticamente.
Cuentas se crean por seed en v1; no endpoint de apertura o cierre en UI sin caso de uso añadido.

Interno: POST /internal/v1/accounts/eligibility-context.
Servicio autorizado, cliente/atributos dentro de su alcance, respuesta mínima para reglas aprobadas.
Interno: POST /internal/v1/accounts/customer-link. La misma credencial de servicio resuelve el usuario de la sesión al cliente dueño en Cuentas. No abre la base de Cuentas a Catálogo. Si no hay vínculo activo, customerId es null.

## Catálogo: /api/v1/catalog

| Método | Ruta | Permiso |
|---|---|---|
| GET | /categories | products:read; categorías públicas activas |
| GET | /products y /products/:id | products:read |
| GET | /me/offers y /me/offers/:id | offers:read:own |
| GET | /customers/:customerId/offers | offers:read:any + alcance |
| GET | /admin/categories y /admin/categories/:id | categories:read |
| GET | /admin/products y /admin/products/:id | products:manage:read |
| GET | /admin/offers y /admin/offers/:id | offers:read |
| POST/PATCH/DELETE | /admin/categories[/:id] | categories:create/update/delete respectivamente |
| POST/PATCH/DELETE | /admin/products[/:id] | products:create/update/delete respectivamente |
| POST/PATCH/DELETE | /admin/offers[/:id] | offers:create/update/delete respectivamente |
| POST | /admin/categories/:id/restore | categories:restore |
| POST | /admin/products/:id/restore | products:restore |
| POST | /admin/offers/:id/restore | offers:restore |
| PUT | /admin/offers/:id/eligibility-rules | offers:rules:manage |
| GET | /admin/offers/:id/assignments | offers:assignments:read |
| POST | /admin/offers/:id/assignments | offers:assign |
| DELETE | /admin/offers/:id/assignments/:assignmentId | offers:assign |

Separación /admin normaliza las rutas discutidas y evita exponer borradores en la consulta de clientes.
Cada verbo requiere permiso separado; no existe permiso literal con slash.
Lectura de eliminados requiere permiso adicional por recurso.
Productos/ofertas de consulta con páginas, filtros por categoría/vigencia y orden.
Oferta personal no accesible si cliente no elegible; fallo de contexto no equivale a aprobación.
No endpoints de interés o contratación.

## Auditoría: /api/v1/audit

| Método | Ruta | Permiso |
|---|---|---|
| GET | /events y /events/:id | audit:read:any |
| GET | /me/events | audit:read:own |
| GET | /correlations/:id/events | audit:read:any |

Páginas y filtros de fecha, actor, servicio, tipo, recurso, resultado; rangos acotados.
Fechas UTC, presentación México. Consultas de auditoría producen su evento, sin generar bucle de autoauditoría.
Sin escrituras HTTP públicas. Usuario consumidor Mongo con mínimo privilegio de anexado.
Rabbit confirma mensaje después de persistir; event_id único; duplicado válido se reconoce sin duplicar.
Validar contenido/versiones, reintentos acotados, dead-letter queue y procedimiento de reproceso.

## IA: /api/v1/ai

| Método | Ruta | Permiso |
|---|---|---|
| POST/GET | /conversations | ai:chat:use; solo propias |
| GET/PATCH/DELETE | /conversations/:id | ai:chat:use; propiedad, título/lógico |
| GET | /conversations/:id/messages | ai:chat:use; cursor |
| POST | /conversations/:id/messages | ai:chat:use; request_id contra duplicados |
| GET | /runs/:id | ai:chat:use; propiedad |
| GET | /runs/:id/events | ai:chat:use; stream autenticado |
| POST | /runs/:id/cancel | ai:chat:use; propiedad |
| GET | /me/metrics | ai:metrics:read:own |
| GET | /runs/:id/metrics | ai:metrics:read:own + propiedad, o ai:metrics:read:any |
| GET | /admin/metrics | ai:metrics:read:any |
| GET | /admin/users/:id/metrics | ai:metrics:read:any |
| GET | /admin/alerts | ai:alerts:read |
| POST | /admin/alerts/:id/acknowledge | ai:alerts:acknowledge |
| GET/PUT | /admin/alert-rules | ai:alerts:configure |
| GET | /admin/documents | ai:documents:read |
| GET | /admin/indexing-jobs/:id | ai:documents:read |
| POST | /admin/documents/:id/reindex | ai:documents:reindex |

Streaming: tipos content, tool_status, confirmation_required, metrics, completed, failed.
Sin tokens en query string. Revalidar sesión para reanudar y ejecutar herramientas; cerrar stream en revocación detectada.
No reejecutar modelo/herramientas al reconectar al stream: reconectar a ejecución existente.
Respuesta incierta/cancelada no significa transferencia revertida.
Sin endpoints para leer conversaciones ajenas.
LangSmith se configura en despliegue, no desde UI.
Envío de correo de alerta solo a destinatarios administrativos validados; no email libre en regla.

## Eventos

Sobre común: event_id, event_type, schema_version, occurred_at, source_service,
actor_type/id, correlation_id, causation_id, payload.
Tipos iniciales: session.revoked, user.deleted, role.updated, role.assignment.changed,
transfer.completed, transfer.rejected, transfer_limits.updated, beneficiary.changed,
product.changed, offer.changed, ai.run.completed/failed/cancelled,
ai.cost_alert.created/acknowledged, notification.delivery.failed.
Permisos de publicación por productor; no aceptar actor arbitrario del cliente.
Eventos con datos mínimos permitidos, sin secretos ni transcripciones.
Cambios de dominio publicables via outbox; publisher con reintentos y recuperación tras caída.
Rabbit puede duplicar/reordenar: deduplicar y usar versiones si se aplica proyección.
La entrega de eventos no es el mecanismo único de revocación de sesiones.
