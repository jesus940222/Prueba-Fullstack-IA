# Contratos de Acceso

Prefijo /api/v1/access. DTOs de entrada explícitos; nunca asignar body completo a entidad.
OpenAPI con esquemas, códigos, ejemplos, seguridad y respuestas de error.
No confundir nuestra sesión con sesión del proveedor Google/Microsoft.

## Autenticación

| Método | Ruta relativa | Protección / efecto |
|---|---|---|
| POST | /auth/login | Email/password; inicia desafío, NO sesión plena |
| GET | /auth/oidc/:provider/start | Google/Microsoft permitidos; state, nonce, PKCE |
| GET | /auth/oidc/:provider/callback | Valida issuer/audience/firma/nonce/state y flujo; inicia desafío |
| POST | /auth/challenges/:id/email/resend | Rate limit y binding; invalida código anterior |
| POST | /auth/challenges/:id/email/verify | Consumo atómico, intentos y vencimiento |
| POST | /auth/challenges/:id/passkey/options | Desafío WebAuthn de login |
| POST | /auth/challenges/:id/passkey/verify | Verificación usuario requerida y validada |
| POST | /auth/challenges/:id/recovery-code/verify | Acceso restringido a recuperación, no bypass general |
| POST | /auth/password/forgot | Respuesta genérica, enlace de uso único |
| POST | /auth/password/reset | Cambia password, revoca sesiones; no omite passkey |
| POST | /auth/refresh | Token válido/rotación; detecta reutilización y revoca familia |

Retornos/siguiente paso tipados: EMAIL_CHALLENGE, PASSKEY_CHALLENGE, PASSKEY_ENROLLMENT_REQUIRED,
RECOVERY_RESTRICTED, AUTHENTICATED. Ningún desafío otorga autorización funcional.
URL de retorno solo interna o lista explícita. OIDC autentica identidad externa; nuestra aplicación exige su verificación adicional.

## Perfil / sesión

| Método | Ruta | Permiso |
|---|---|---|
| GET | /me | profile:read:own |
| PATCH | /me | profile:update:own |
| GET | /me/permissions | sesión válida en la aplicación |
| POST | /me/password/change | security:manage:own + verificación reciente |
| GET | /me/sessions | sessions:read:own |
| DELETE | /me/sessions/:id | sessions:revoke:own + propiedad |
| POST | /auth/logout | sesión actual |
| POST | /auth/logout-all | todas las sesiones propias |

PATCH /me permite nombre, teléfono y tema; no roles, email verificado o estado.
Cambio de email mediante flujo propio con verificación de dirección nueva, reautenticación y revocación; si no se implementa, email no editable en v1.
Revocar sesión es idempotente; mantener evidencia.

## Passkeys e identidades

| Método | Ruta | Permiso |
|---|---|---|
| GET | /me/passkeys | security:manage:own |
| POST | /me/passkeys/registration/options | security:manage:own o sesión restringida de alta |
| POST | /me/passkeys/registration/verify | igual; binding al desafío y reautenticación |
| PATCH | /me/passkeys/:id | security:manage:own; solo nombre |
| DELETE | /me/passkeys/:id | security:manage:own; revoca |
| POST | /me/recovery-codes/regenerate | security:manage:own; reautenticación, muestra una vez |
| GET | /me/identities | security:manage:own |
| POST | /me/identities/:provider/link | security:manage:own; flujo autenticado con callback validado |
| DELETE | /me/identities/:id | security:manage:own; no dejar sin acceso utilizable |

La callback de vinculación distingue intención link/login y vincula al usuario/sesión que la inició.
No vincular automáticamente por coincidencia de email.
No guardar ni mostrar credential_id crudo como identificador de UI; utilizar id interno.
No desactivar passkey mediante revocar la última credencial. Exigir reemplazo o recuperación autorizada.
Activación, desactivación y recuperación revocan sesiones y generan notificación local/auditoría.

## Usuarios

| Método | Ruta | Permiso |
|---|---|---|
| GET | /users y /users/:id | users:read; proyección según rol/alcance |
| POST | /users | users:create; invitación, no password legible |
| PATCH | /users/:id | users:update; campos permitidos |
| DELETE | /users/:id | users:delete; lógico y revocación |
| POST | /users/:id/restore | users:restore |
| POST | /users/:id/sessions/revoke | sessions:revoke:any |
| PATCH | /users/:id/passkey-policy | security:passkeys:configure |
| POST | /users/:id/recovery-requests | security:recovery:initiate |
| POST | /recovery-requests/:id/complete | security:recovery:complete; procedimiento controlado |

Soporte ve proyección mínima. No secretos/credenciales/finanzas.
No mezclar users:update con roles, passkeys o recuperaciones.
Recuperación administrativa propuesta: dos actores administrativos distintos cuando implique quitar passkey;
el iniciador no completa; registrar evidencia permitida y notificar, sin subir documentos sensibles a auditoría.
Revisar política final antes de habilitarla; si no está resuelta, endpoint rechaza y no usa bypass.

## Aplicaciones y roles

| Método | Ruta | Permiso |
|---|---|---|
| GET | /applications y /applications/:id | applications:read |
| POST | /applications | applications:create |
| PATCH | /applications/:id | applications:update |
| DELETE | /applications/:id | applications:delete |
| POST | /applications/:id/restore | applications:restore |
| GET | /applications/:appId/permissions | permissions:read |
| GET | /applications/:appId/roles y /:roleId | roles:read |
| POST | /applications/:appId/roles | roles:create |
| PATCH | /applications/:appId/roles/:roleId | roles:update |
| DELETE | /applications/:appId/roles/:roleId | roles:delete |
| POST | /applications/:appId/roles/:roleId/restore | roles:restore |
| PUT | /applications/:appId/roles/:roleId/permissions | roles:permissions:assign |
| GET | /users/:userId/role-assignments | users:roles:read |
| POST | /users/:userId/role-assignments | users:roles:assign |
| DELETE | /users/:userId/role-assignments/:id | users:roles:revoke |

No endpoints de escritura del catálogo Permission.
PUT permisos reemplaza conjunto de forma atómica, versionada/optimistic locking para prevenir pérdida de cambios.
Bloquear eliminación de rol con asignaciones activas.
Bloquear pérdida del último administrador efectivo, incluso por concurrencia o por modificación de permisos de su rol.
No ampliar facultades de delegación con el mismo API ni autoelevarse.
No permitir que asignar un rol eluda la validación de cada permiso delegable.
Listados incluyen page/pageSize y filtros validados. Eliminados solo con permiso específico, p. ej. users:read:deleted,
roles:read:deleted y applications:read:deleted; no deducir acceso a eliminados de read normal.

## Contrato interno

POST /internal/v1/access/authorize, sin exposición pública.
POST /internal/v1/access/alert-recipients, sin exposición pública. Solo el servicio `ai`, audiencia `access.alert-recipients`. Devuelve correo de usuarios activos que tienen `ai:alerts:read`. No acepta una lista libre de correos.
Autentica servicio llamante. Entrada validada: referencia/credencial de sesión, aplicación, permiso y contexto permitido.
Devuelve principal mínimo validado, decisión y versión de autorización, no secretos.
`requireRecentVerification` es opcional. Si viene en true, Acceso aplica el plazo ya configurado sobre `verified_at` y niega con `recent_verification_required` sin devolver el secreto de sesión. Cuentas lo necesita porque no puede leer la base de Acceso.
Cliente no puede forjar actor mediante cabeceras. No enviar un user_id sin prueba de sesión y considerarlo autenticado.
Dependencia caída => fallo cerrado para operación protegida (503, no confundir con sesión inválida).
Comprobación authoritative de usuario, sesión y versión; permisos Redis por versión, no caché positiva obsoleta.
No aceptar credenciales de servicio como autorización financiera ilimitada.
