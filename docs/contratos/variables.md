# Variables, validaciones y dependencias

Los valores numéricos de sesión, transferencias e IA son propuestas de demostración de `docs/01`, no requisitos del PDF. Toda duración lleva unidad. Una combinación inválida impide arrancar. Lo ya emitido no se extiende al cambiar el entorno. `.env.example` de la fase 2 no contendrá secretos. Ninguna variable `VITE_` lleva credenciales.

## Validación de arranque

- Límite por operación menor o igual al diario, ambos positivos y dentro del techo.
- Techos positivos y por encima de los límites iniciales.
- Páginas entre 1 y 100, cursores entre 1 y 50, ambos con default 20.
- Presupuestos positivos: ejecución menor o igual a usuario-día y este menor o igual a global-día.
- Avisos en 80 y 100, cooldown positivo.
- Pasos y timeout positivos.
- Dimensión de embeddings igual a la colección Qdrant.
- Emisores de Microsoft no vacíos antes de marcar OIDC Microsoft como disponible. Vacío significa capacidad no disponible, no un tenant implícito.
- `OPENAI_API_KEY` vacía deja el chat no disponible. No activa un modelo simulado en el perfil de demostración.

## Propuestas configurables

| Variable | Unidad | Valor inicial |
|---|---|---|
| `FINANCIAL_CURRENCY` | código | `MXN` |
| `FINANCIAL_TIME_ZONE` | IANA | `America/Mexico_City` |
| `TRANSFER_LIMIT_PER_OPERATION` | MXN | `10000.00` |
| `TRANSFER_LIMIT_DAILY` | MXN | `10000.00` |
| `TRANSFER_LIMIT_PER_OPERATION_MAX` | MXN | `50000.00` |
| `TRANSFER_LIMIT_DAILY_MAX` | MXN | `100000.00` |
| `TRANSFER_PROPOSAL_TTL` | segundos | `300` |
| `RECENT_VERIFICATION_TTL` | segundos | `300` |
| `ACCESS_TOKEN_TTL` | segundos | `600` |
| `SESSION_ABSOLUTE_TTL` | segundos | `28800` |
| `SESSION_IDLE_TTL` | segundos | `1800` |
| `EMAIL_CODE_TTL` | segundos | `300` |
| `EMAIL_CODE_MAX_ATTEMPTS` | intentos | `5` |
| `PAGE_SIZE_DEFAULT` | ítems | `20` |
| `PAGE_SIZE_MAX` | ítems | `100` |
| `CURSOR_LIMIT_DEFAULT` | ítems | `20` |
| `CURSOR_LIMIT_MAX` | ítems | `50` |
| `AI_BUDGET_RUN_USD` | USD | `1.00` |
| `AI_BUDGET_USER_DAY_USD` | USD | `5.00` |
| `AI_BUDGET_GLOBAL_DAY_USD` | USD | `25.00` |
| `AI_BUDGET_WARN_PERCENT` | porcentaje | `80,100` |
| `AI_ALERT_COOLDOWN` | segundos | `1800` |
| `AI_MAX_STEPS` | pasos | `8` |
| `AI_RUN_TIMEOUT` | segundos | `60` |
| `AI_MAX_TOTAL_TOKENS` | tokens | `8000` |
| `AI_CHAT_RATE_LIMIT` | mensajes | `20` |
| `AI_CHAT_RATE_WINDOW` | segundos | `60` |
| `AI_MAX_CONCURRENCY` | ejecuciones | `2` |
| `AI_BUDGET_RESERVE_USD` | USD | `0.05` |
| `PHONE_DEFAULT_REGION` | ISO | `MX` |
| `PHONE_DEFAULT_CALLING_CODE` | E.164 | `+52` |

## Límites de transporte añadidos en esta fase

También son propuestas, para que el contrato tenga cota. No vienen del PDF.

| Variable | Valor inicial | Motivo |
|---|---|---|
| `CONCEPT_MAX_LENGTH` | `140` | Tope del concepto de transferencia |
| `ACCOUNT_NUMBER_PATTERN` | `^[0-9]{10,18}$` | Identificador de demostración, sin validar CLABE |
| `PASSWORD_MIN_LENGTH` | `12` | Piso provisional; la fase 3 lo contrasta con OWASP |
| `RECOVERY_CODE_COUNT` | `10` | Códigos mostrados una sola vez |
| `DISPLAY_NAME_MAX_LENGTH` | `80` | Nombre y alias |
| `QDRANT_VECTOR_SIZE` | `3072` | Dimensión por defecto del embedding elegido |
| `AUDIT_RANGE_MAX_DAYS` | `31` | Rango máximo de una consulta de auditoría |

## Integraciones

| Dependencia | Variable | Ausente |
|---|---|---|
| PostgreSQL, una base por servicio | `ACCESS_DATABASE_URL`, `ACCOUNTS_DATABASE_URL`, `CATALOG_DATABASE_URL`, `AI_DATABASE_URL` | El servicio no arranca |
| MongoDB | `AUDIT_CONSUMER_URL`, `AUDIT_API_URL` | Auditoría no arranca |
| Redis | `ACCESS_REDIS_URL` | Acceso arranca y lee permisos en PostgreSQL; no autoriza por caché vacía |
| RabbitMQ | `RABBITMQ_URL` | El outbox queda pendiente; el negocio ya confirmado no se repite |
| Qdrant | `QDRANT_URL` | El RAG queda no disponible |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_CONVERSATION_MODEL`, `OPENAI_EMBEDDING_MODEL` | Chat e indexación no disponibles |
| Google OIDC | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Botón Google no disponible |
| Microsoft OIDC | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`, `MICROSOFT_ALLOWED_ISSUERS` | Botón Microsoft no disponible |
| WebAuthn | `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_NAME` | Alta y verificación no disponibles |
| Correo local | `SMTP_URL` | El desafío de correo falla con 503; no sale a Internet |
| JWT | `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_ACTIVE_KID` | Acceso no arranca |
| CSRF y HMAC | `CSRF_SECRET`, `OTP_HMAC_SECRET` | Acceso no arranca |
| LangSmith | `LANGSMITH_TRACING=false`, y clave, endpoint, proyecto y workspace opcionales | Sigue apagado |

`OPENAI_CONVERSATION_MODEL` inicia en `gpt-6-luna`. `OPENAI_EMBEDDING_MODEL` inicia en `text-embedding-3-large`. La tarifa se versiona en configuración y no se copia aquí como verdad permanente. Las cifras leídas el 21 de octubre de 2026 están en el ADR 0001.

Las credenciales de servicio son una por llamante: `ACCOUNTS_SERVICE_SECRET`, `CATALOG_SERVICE_SECRET`, `AUDIT_SERVICE_SECRET` e `AI_SERVICE_SECRET`. No se pegan en el chat ni en el repositorio.
