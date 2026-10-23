# ADR 0003. Sesión y revocación

- Estado: aceptado el 21 de octubre de 2026.

## Decisión

La sesión de la aplicación no es la sesión de Google o Microsoft. Un JWT válido tampoco basta. Cada llamada protegida comprueba firma, emisor, audiencia y caducidad con las claves públicas de `GET /api/v1/access/.well-known/jwks.json`, y después el estado de sesión, usuario y versión en Acceso.

El access token dura 10 minutos y la sesión absoluta 8 horas, con inactividad de 30 minutos. Son propuestas configurables. Lo ya emitido no se alarga al cambiar la variable. Las cookies `portal_session` y `portal_refresh` son HttpOnly, con `Secure` fuera de localhost, `SameSite` apropiado y path mínimo. No van a `localStorage`, Zustand ni la query. Las mutaciones con cookie exigen `X-CSRF-Token`. El mismo origen no elimina el CSRF.

El refresh rota dentro de una familia. Reutilizar un token ya usado revoca la familia. Cambiar rol, permisos, asignación, estado, borrado, recuperación o mecanismo de seguridad incrementa la versión y revoca sesiones y refresh afectados en la misma transacción de Acceso.

## Carrera entre Acceso y Cuentas

No hay atomicidad distribuida. La garantía es anterior al efecto: después de confirmar la revocación, una comprobación nueva de authorize falla. Cuentas repite esa comprobación inmediatamente antes de ejecutar y rechaza propuestas de una sesión revocada. Una operación que ya pasó ese segundo allow y confirmó su transacción local puede completarse. No se oculta esa ventana con el evento asíncrono `session.revoked`.

Si Acceso o su base no pueden contestar, la operación protegida responde 503. Un 401 se reserva a la sesión que sí se comprobó inválida. El frontend limpia estado solo en 401.

## Microsoft sin tenant implícito

`MICROSOFT_ALLOWED_ISSUERS` vacío, o un valor `common`, `organizations` o `consumers`, deja el proveedor no configurado. El arranque no redirige a `/common`. La URL de autorización y el descubrimiento salen del emisor explícito `https://login.microsoftonline.com/{tenant}/v2.0`. El enlace de la pantalla de entrada solo se muestra si la capacidad está configurada.

## Consecuencias

Restaurar un usuario no reactiva credenciales, passkeys, identidades externas ni sesiones. La fase 3 debe probar JWT revocado, refresh reutilizado, cambio de rol y la ventana anterior al segundo authorize. Este ADR no afirma que esas pruebas ya se ejecutaron.
