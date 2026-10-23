# Amenazas y pruebas por riesgo

Este plan está atado al diseño de la fase 1. Nombrar una prueba no significa que ya se ejecutó. La fase que la implementa debe guardar el informe real.

| Riesgo | Qué lo impide en el diseño | Prueba que debe fallar si el control no existe |
|---|---|---|
| IDOR de cuenta, movimiento, propuesta o beneficiario | El permiso own se cruza con el cliente de la sesión dentro de Cuentas | Leer o confirmar un identificador de otra persona devuelve 404, sin filtrar el saldo |
| Mass assignment | DTO con allowlist y `additionalProperties: false` | Enviar `role`, `balance`, `authorizationVersion` o `emailVerified` no cambia esos campos |
| JWT robado tras revocación | Firma más estado de sesión y versión | Un token firmado de una sesión revocada recibe 401 y el frontend limpia el estado |
| Refresh reutilizado | Familia revocada al reuso | El segundo uso del mismo refresh revoca la familia y no emite otro par |
| Autoelevación | Sin autoasignación y sin editar el rol propio; catálogo y dinero fuera del conjunto delegable | El administrador no se asigna `cliente` ni mete `transfers:create:own` en un rol personalizado |
| Último administrador | Invariante en la misma transacción | Dos bajas concurrentes dejan al menos un administrador efectivo |
| Restauración insegura | El alta anterior permanece revocada | Restaurar no devuelve contraseña, passkey, identidad externa ni sesión |
| OIDC alterado | Emisor, audiencia, nonce, state y PKCE; sin vínculo por correo | Un token de otra aplicación o un state de login usado para vincular se rechaza |
| Replay WebAuthn | Desafío de un uso, origen y RP ID | Repetir la aserción o cambiar el origen no crea sesión |
| OTP pequeño | HMAC fuera de la base, consumo atómico, cinco intentos | El código vencido o ya usado responde `CHALLENGE_INVALID` y no abre sesión |
| CSRF con cookie | Cabecera en mutaciones, aunque el proxy sea del mismo origen | Una mutación sin `X-CSRF-Token` recibe 403 |
| Doble transferencia | Unicidad de propuesta e idempotencia | Dos claves distintas para una propuesta y dos peticiones con la misma clave no duplican el movimiento |
| Carrera de saldo y de límite | Bloqueos ordenados y acumulado diario serializado | Dos débitos simultáneos no dejan saldo negativo ni superan el diario |
| Authorize obsoleto | Segunda comprobación antes del débito; 503 si Acceso no responde | Revocar entre preparar y confirmar impide el débito; apagar Acceso también |
| Evento duplicado o broker caído | Outbox y `event_id` único; la consulta no vuelve al broker | Reiniciar entre commit y publicación no repite el dinero y, al recuperarse, deja un solo documento |
| Elegibilidad caída | Sin contexto no hay concesión | Apagar Cuentas no vuelve elegible una oferta por reglas |
| Prompt injection | Esquemas, allowlist y autorización por llamada; el documento no es instrucción | Un texto de chat, documento o herramienta no confirma una transferencia ni lee una cuenta ajena |
| Documento borrado | Metadatos de IA antes de aceptar el vector | El fragmento de un documento inactivo no llega al modelo |
| Stream reconectado | La reconexión lee la ejecución existente | Reconectar no vuelve a llamar al modelo ni a `prepare_transfer` |
| Métrica que abre chats | Rutas de métricas sin cuerpo de mensajes | `ai:metrics:read:any` no tiene un endpoint de conversación ajena |
| Coste inventado | `usage_complete` y tarifa versionada | Una respuesta sin usage no se guarda como cero |
| LangSmith con datos de más | Apagado por defecto y allowlist | Un capturador no ve saldos, OTP ni argumentos de transferencia |
| Destinatario de alerta libre | Solo administradores ya validados | Un correo escrito en la regla no se acepta |
| SSRF de RAG | Sin ingestión de URL arbitraria | Una URL en el chat no se descarga |
| Cabecera de identidad | El proxy la elimina y authorize exige sesión | `X-User-Id` de otro usuario no cambia el actor |
| Enumeración de cuentas | Resolve con datos mínimos y el mismo 404 | Variar un número inexistente no abre un directorio de clientes |
| Recuperación improvisada | `RECOVERY_POLICY_DISABLED` | Completar la recuperación, incluso siendo administrador, no quita la passkey en v1 |

La fase 2 cubre el esqueleto: imports del dominio, health honesto, migración repetible y logs sin secretos. La fase 3 cubre acceso y delegación. La fase 4 cubre dinero. La fase 5 cubre eventos, elegibilidad y pantallas. La fase 6 cubre RAG, coste y LangSmith. La fase 7 solo puede citar informes generados por esas ejecuciones.

No se declarará certificación ni preparación para producción financiera aunque esas pruebas pasen.
