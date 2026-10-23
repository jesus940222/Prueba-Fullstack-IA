# Dominio, modelos y consistencia

## Clean Architecture y DDD

Dominio puro y casos de uso independientes de frameworks.
Infraestructura contiene modelos ORM, mapeadores, conexiones, proveedores y repositorios concretos.
Presentación valida transporte, transforma errores y llama a casos de uso.
Composición conecta dependencias, no implementa reglas.
Reglas de negocio en entidades, objetos de valor y políticas; no en controllers, ORM hooks o prompts.
Puertos de repositorio por agregado/capacidad, no una abstracción universal CRUD.
No necesitar DDD táctico complejo para documentos simples de auditoría.

Objetos de valor sugeridos: Money (decimal exacto y moneda), AccountId, UserId, TransferLimit, Email, PhoneNumber.
Agregados sugeridos: User, Session, Role, Account, TransferProposal, Transfer, Beneficiary, Product y Offer.
TransferService de dominio coordina reglas entre cuentas; aplicación coordina transacción y puertos.
Actualizar dos agregados Account en una transacción local es válido para esta operación crítica; no introducir una saga distribuida para débito/crédito dentro del mismo servicio.

## Convenciones

IDs UUID, UTC en persistencia y transporte.
Fechas operativas diarias según America/Mexico_City con intervalo [inicio, siguiente inicio).
Dinero NUMERIC(18,2), sin float; JSON string decimal.
Datos editables: created_at/by, updated_at/by, deleted_at/by cuando aplique; status no sustituye deleted_at.
Referencias externas no son FK entre DBs. Evitar borrados físicos en cascada.
Índices únicos, restauraciones y registros eliminados tienen reglas explícitas.
Reservar identificadores de seguridad (email normalizado e identidades) para impedir apropiación accidental tras borrado.
Restaurar falla por conflicto si no puede conservar invariantes; nunca fusionar identidades automáticamente.

## Acceso

| Entidad | Campos específicos |
|---|---|
| User | id, email, email_normalized, email_verified_at, given_name, family_name, status, authorization_version, theme_preference, last_login_at, phone_country_code=MX, phone_calling_code=+52, phone_number, phone_e164, phone_verified_at |
| PasswordCredential | id, user_id, password_hash, password_changed_at, revoked_at |
| ExternalIdentity | id, user_id, provider, issuer, subject, linked_at, revoked_at |
| Application | id, code, name, description, status |
| Permission | id, application_id, code, description, resource, action, scope, status |
| Role | id, application_id, code, name, description, status |
| RolePermission | id, role_id, permission_id, assigned_by, deleted_at/by |
| UserRole | id, user_id, role_id, assigned_by, expires_at, deleted_at/by |
| PasskeyPolicy | user_id, status=disabled/pending/active, enabled_by/at, activated_at |
| PasskeyCredential | id, user_id, credential_id, public_key, sign_count, transports, name, last_used_at, revoked_at/by, backup flags cuando aplique |
| Session | id, user_id, application_id, authentication_method, verified_at, authorization_version, created_at, expires_at, last_seen_at, revoked_at, revocation_reason |
| RefreshToken | id, session_id, token_hash, expires_at, used_at, revoked_at, replaced_by_id, family_id |
| AuthChallenge | id, user_id, purpose, protected verifier, attempt_count, expires_at, consumed_at, invalidated_at, binding |
| RecoveryCode | id, user_id, code_hash, used_at, revoked_at |

Teléfono se almacena como texto y se valida/normaliza a E.164. MX/+52 son predeterminados, no prueba de nacionalidad ni de titularidad. Capturarlo no verifica el número. No habilitar SMS/WhatsApp en esta versión.
OIDC identifica por issuer + subject, no solo email.
Email no siempre está disponible/verificado en proveedores: onboarding controlado para obtener correo de contacto verificado.
OTP corto: verifier protegido mediante HMAC con secreto fuera de DB, consumo atómico y rate limiting; hash simple por sí solo no protege un espacio pequeño.
No almacenar biometría, PIN ni clave privada WebAuthn.
Desafíos WebAuthn aleatorios, de un uso, vinculados a usuario/flujo/origen y con expiración.

## Cuentas

| Entidad | Campos específicos |
|---|---|
| Customer | id, customer_number, given_name, family_name, status |
| UserCustomer | id, user_id, customer_id, status |
| Account | id, customer_id, account_number, name, currency, status, balance, closed_at |
| Beneficiary | id, customer_id, destination_account_id, alias, status |
| UserTransferLimits | id, user_id, currency, per_transfer_limit, daily_limit, updated_by |
| TransferProposal | id, user_id, session_id, source_account_id, destination_account_id, amount, currency, concept, status, expires_at, confirmed_at |
| Transfer | id, reference, proposal_id, initiated_by, source_account_id, destination_account_id, amount, currency, concept, status, completed_at, reversal_of_id |
| Movement | id, account_id, transfer_id, type, direction=in/out, amount, currency, balance_after, recorded_at |
| IdempotencyRecord | id, user_id, operation, idempotency_key, request_hash, transfer_id, status, expires_at |
| OutboxEvent | id, event_type, aggregate_id, payload, occurred_at, published_at, attempt_count |

Destinatario: beneficiary_id XOR destination_account_number.
Propuesta inmutable, vinculada a usuario/sesión, vencimiento y valores exactos. Al cambiar datos, nueva propuesta.
Propuesta no reserva fondos: volver a verificar al confirmar.
Transferir solo desde cuenta propia; destino activo, distinto de origen y misma moneda.
Bloquear cuentas en orden determinista y serializar presupuesto diario por usuario para evitar carreras y deadlocks.
Débito, crédito, dos movimientos, transferencia, consumo diario, idempotencia y outbox en una transacción.
Saldo >= 0 y siempre igual a movimientos; apertura respaldada por movimiento.
Idempotencia con unicidad en DB; misma clave/datos devuelve operación, diferente hash devuelve 409.
Confirmación duplicada de una propuesta tampoco genera segunda transferencia con otra clave.
Transferencias confirmadas cuentan para límite diario; reversa no repone presupuesto automáticamente.
Transferencia es diferente de gasto comercial; no clasificar toda salida como gasto.
Comprobante generado con datos inmutables, no reconstruido solo con alias mutable.
No exponer API de reversa en v1 salvo que se implemente un caso de uso y autorización explícitos; modelar la corrección sin manipulación de movimientos.
Cerrar cuenta: saldo cero, sin operaciones pendientes.
Borrar beneficiario no altera históricos.

## Catálogo

Category: id, code, name, description, status.
Product: id, category_id, code, name, summary, description, currency, terms_version, terms_text, status.
ProductConditions: id, product_id, schema_version, attributes JSONB validado por categoría.
Offer: id, product_id, code, title, description, benefit_type, benefit_value, starts_at, ends_at, priority, audience_type=general/rules/direct, status.
EligibilityRule: id, offer_id, field, operator, value.
OfferAssignment: id, offer_id, customer_id, assigned_by, reason, deleted_at/by.

Reglas AND iniciales; campos/operadores permitidos definidos en código.
Sin SQL/eval/expresiones arbitrarias desde DB.
Saldo/antigüedad desde API interna de Cuentas, no tablas.
Contexto no disponible => elegibilidad no verificable, no conceder por defecto.
Ofertas ficticias no equivalen a aprobación crediticia.
Sin Interest, contratación ni movimientos financieros.
Cambios de términos versionados; restaurar producto no reactiva ofertas previas.

## Auditoría

event_id único, event_type, schema_version, occurred_at, received_at, source_service,
actor_type/id, customer_id opcional, resource_type/id, action, outcome, reason_code,
channel, correlation_id, causation_id, changes redactados, metadata permitidos.
Solo anexado. No contraseñas, OTP, tokens, biometría, prompts completos o razonamiento.
Identidad/resultados establecidos por backend, nunca por texto del cliente/LLM.

## IA

Conversation: id, user_id, title, status y fechas lógicas.
Message: id, conversation_id, role, content, status, created_at, deleted_at.
AIRun: id, conversation_id, session_id, status, model, prompt_version, tiempos,
input/output/cached/total_tokens, usage_complete, estimated_cost_usd, pricing_version,
correlation_id, cancellation_requested_at.
ToolInvocation: id, run_id, tool_name, argumentos permitidos/redactados, status, result_reference, duration.
KnowledgeDocument: id, code, title, version, content_hash, audience, status, deleted_at.
IndexingJob: id, document_id, embedding_model, dimensions, status, processed_chunks, error_code.
AlertRule: id, scope, metric, threshold, window, cooldown, enabled, version.
CostAlert: id, rule_id, user_id opcional, window_start/end, observed_value, status, acknowledged_by/at.
NotificationDelivery: id, alert_id, channel, administrative_recipient_id, status, attempts, delivered_at.
Capacidades versionadas en código: nombre, schema, permiso, scope, confirmación requerida.

Checkpoints de LangGraph separados de tablas del negocio, sin secretos. No son fuente de verdad de transferencias.
Borrar conversación oculta mensajes y excluye checkpoints de uso posterior; no elimina evidencia financiera/auditoría.

## Seeds

Una aplicación; cuatro roles principales; gestor de catálogo personalizado; usuarios ficticios por rol.
Tres clientes y dos cuentas MXN por cliente, fondos ficticios respaldados por apertura.
Movimientos consistentes, beneficiarios y destinatarios ocasionales.
Productos ficticios en inversión/préstamo/seguro; ofertas generales, por reglas y directas.
Documentación RAG versionada. Sin identidades externas ni passkeys falsamente verificadas.
Seeds idempotentes, explícitos y no destructivos. No reactivar lógicamente eliminados por repetir seed.
Passwords por bootstrap seguro configurable; no secretos fijos en código o logs.
