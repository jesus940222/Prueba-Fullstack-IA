# Fase 3: Acceso completo y frontend asociado

Implementa docs/02, docs/03, docs/05 y pantallas de Acceso de docs/06.
Extiende base y contratos de fase 1, no reemplaces arquitectura por controllers CRUD.

Dominio/aplicación:
- Usuarios/aplicaciones, roles dinámicos, permisos por migraciones y asignaciones.
- Facultades de delegación explícitas, prevención autoelevación, último administrador y restauración segura.
- Sesiones y versiones authoritative; revocación consistente incluso cambios de rol masivos.
- Puerto interno authorize con autenticación de servicio y contexto de usuario comprobado.
- Hash de contraseña seguro; refresh rotatorio/familias; logout actual/global.
- Local email/password y Google/Microsoft OIDC correctamente validados.
- Email verificado y desafíos vinculados/atómicos con límites.
- Passkeys por usuario: disabled/pending/active; registro WebAuthn/UV required, varias credenciales,
  revocación y recuperación sin bypass por email.
- Invitaciones y recuperación; completar proceso administrativo con controles explícitos.
- Outbox de eventos sensibles sin secretos.

Infra/frontend:
- PostgreSQL/TypeORM+migraciones, Redis solo según responsabilidad.
- Plantillas email HTML responsive + texto: marca, título, código legible, expiración y aviso.
- Buzón local capturado; no correos externos reales.
- UI login/SSO/OTP/passkeys, perfil/teléfono/tema, sesiones, roles/usuarios/asignaciones.
- Formularios RHF/Zod y URL validada, tablas paginadas.
- Cookies/CSRF, errores seguros y limpieza de caché por logout/revocación.
- OIDC fixtures/test keys solo perfil de tests. Flujo real exige registros/credenciales.

Gate:
Unitarios e integración cubren permisos, delegación, concurrencia último admin, restauración,
revocación, refresh reuse, OTP, OIDC alterado/replay y passkey/recovery.
E2e de login y permisos con proveedor controlado; prueba real por separado cuando sea posible.
Coverage >=70% por servicio implementado y tests frontend.
No acreditar autenticación real solo por simular el proveedor.
Si no hay credenciales externas, mantener implementación/contratos completos y reportar smoke real pendiente.
