# Seguridad, autorización y sesiones

## Matriz inicial

| Capacidad | Cliente | Soporte | Auditor | Administrador |
|---|---|---|---|---|
| Perfil, seguridad y sesiones propios | Sí | Sí | Sí | Sí |
| Cuentas, movimientos, transferencias, beneficiarios propios | Sí | No | No | No |
| Límites personales | Sí | No | No | No |
| Productos y ofertas propias | Sí | No | No | No |
| Datos limitados de usuarios | No | Sí | No | Sí |
| Usuarios, roles y asignaciones | No | No | No | Sí |
| Iniciar recuperación administrativa | No | Sí | No | Sí |
| Completar recuperación | No | No | No | Control especial |
| Auditoría global | No | No | Sí | No |
| Chat y métricas propias | Sí | Sí | Sí | Sí |
| Métricas globales y alertas IA | No | No | No | Sí |
| Configurar alertas IA | No | No | No | Sí |
| Catálogo administrativo / documentos RAG | No | No | No | No |

Gestor de catálogo, rol personalizado: categorías/productos/ofertas CRUD lógico, reglas, asignaciones y restauración permitida; sin acceso financiero ni de identidad.
Permisos personales iniciales: profile:read:own, profile:update:own, security:manage:own,
sessions:read:own, sessions:revoke:own, ai:chat:use, ai:metrics:read:own.
Cliente agrega accounts:read:own, transactions:read:own, transfers:read:own,
transfers:create:own, beneficiaries:read/create/update/delete:own (cada uno separado),
transfer-limits:read:own, transfer-limits:update:own, products:read, offers:read:own.
Soporte: users:read limitado, security:recovery:initiate.
Auditor: audit:read:any.
Administrador: permisos de administración de Acceso y métricas/alertas definidos explícitamente; no comodín "*".
Permisos de recuperación completa, acceso a eliminados y delegación sujetos a política explícita, no derivados de users:update.
Roles pueden combinarse solo dentro de reglas de separación/delegación.
Todas las pantallas, APIs y herramientas verifican permisos canónicos.

## Revocación

Cambiar rol/permisos/asignación, desactivar usuario, borrar usuario, recuperar acceso o modificar mecanismo de seguridad invalida sesiones afectadas y renovación.
Actualización de versión/revocación efectiva y cambio administrativo en transacción consistente de Acceso.
Si cambia rol para muchos usuarios, comprobar versión del rol/política vigente sin ventana de fanout pendiente.
Redis cachea permisos con claves por versiones; falta de dato vuelve a fuente authoritative.
No usar caché positiva local de vigencia que prolongue tokens revocados.
Cada solicitud protegida valida JWT (firma, issuer, audience, expiración) y estado actual mediante Acceso.
Usar bibliotecas mantenidas y algoritmos permitidos explícitos; rotación de claves con identificadores y plan.
Una firma válida no concede acceso si sesión/usuario/versión ya no son válidos.
503 al no poder verificar; 401 si sesión efectivamente inválida; limpiar estado frontend en 401.

Garantía precisa: tras confirmar revocación se rechazan nuevas comprobaciones de autorización.
Una solicitud ya autorizada/en ejecución puede haber pasado el punto de confirmación antes del cambio.
Cuentas revalida inmediatamente antes de ejecutar y rechaza propuestas pendientes de sesión revocada.
No prometer cancelación retroactiva ni atomicidad global entre DB de Acceso y DB de Cuentas.
Documentar esta carrera y el punto de autorización, probarla y no ocultarla con eventos asíncronos.

## Sesión frontend

Preferir credenciales en cookies HttpOnly, Secure fuera de localhost, SameSite apropiado,
Path/Domain mínimos y CSRF explícito en operaciones con cookies.
No tokens persistidos en localStorage/Zustand/query string.
CORS lista permitida; proxy mismo origen no elimina necesidad de CSRF.
Refresh rotatorio con familias y detección de reutilización.
Cerrar sesión limpia caché Query, Zustand sensible y conversación visible.
Separar permisos de UI de autorización real.
Revalidar también acciones iniciadas desde chat/streams.

## Identidades y recuperación

Password con biblioteca de hash adecuada, parámetros documentados; no cifrado reversible.
Rate limiting por cuenta/contexto/IP con límites que no permitan bloqueo abusivo fácil.
Mensajes de recuperación genéricos, tokens fuertes de uso único, expiración, invalidación y notificación.
Google/Microsoft: authorization code, PKCE cuando corresponda, state, nonce, redirect exacto,
firma/audience/issuer y descubrimiento seguros; no aceptar tokens destinados a otra app.
Microsoft tenants/cuentas admitidos configurados explícitamente.
No asociación por email sola. Vincular requiere control de ambas identidades y sesión reciente.
Passkeys: WebAuthn origin/RP ID exactos, challenge de un uso, user verification required.
Tratar contadores y flags según características de passkeys sincronizadas; no asumir contador siempre creciente.
Admin habilita, usuario registra; no permitir login funcional con passkey requerida sin alta completada.
Recuperación sin passkey no usa email como bypass; códigos de respaldo o procedimiento administrativo protegido.
Revocar credencial lógicamente impide uso permanente; no restauración accidental.
No guardar biometría, claves privadas o material de recuperación legible.

## Recursos y privilegios

Validar propiedad/alcance contra datos de negocio: BOLA/IDOR, no solo permiso por endpoint.
DTOs allowlist, no mass assignment. Parámetros y ordenamiento validados.
Delegación autorizada por conjunto de capacidades; no crear roles con permisos fuera de ese conjunto.
Tener permiso no equivale a delegarlo. No autoescalamiento ni cambios indirectos al propio rol.
Proteger último administrador ante cambios y concurrencia; administrador de Acceso no equivale a operador financiero.
Servicio llamante autentica identidad con credencial individual rotatoria y alcance/audience mínimos.
No confiar en X-User-Id o roles arbitrarios. Remover cabeceras de identidad externas en el proxy.

## Transferencias

Idempotencia durable y unicidad por propuesta; locks deterministas; transacción local; límites diarios concurrencia.
Dinero exacto; no saldo en caché para autorizar gasto.
Recencia y confirmación del usuario sobre valores exactos; nuevo importe => nueva propuesta.
Resolve destinatario mínimo, rate limits y respuesta sin filtrar existencia masiva.
Reintentos HTTP no ejecutan operaciones mutantes ciegamente.
Corregir con compensación y permisos; nunca UPDATE de movimientos confirmados.

## App / infraestructura

Consultas parametrizadas; validación Zod frontend no sustituye backend.
Evitar HTML crudo; sanitizar Markdown del chat, sin scripts/iframes/URLs peligrosas.
CSP compatible, cabeceras de seguridad y límites de body.
Errores sin stacktrace, SQL, tokens o secretos.
Secretos en configuración protegida; .env excluido, .env.example sin valores reales.
Contenedores mínimos/no root cuando sea viable; redes internas, puertos mínimos y permisos DB por servicio.
No montajes de Docker socket ni privilegios amplios.
Dependencias/lockfiles e imágenes fijadas; análisis de vulnerabilidades con excepciones justificadas.
No prometer cifrado en reposo de un volumen local sin implementarlo; documentar controles reales y brechas.
No reutilizar contraseña de bootstrap fuera de demo ni escribirla en logs.

## IA / observabilidad

Modelo no es autoridad de identidad, elegibilidad ni confirmación.
No herramientas de SQL, shell, HTTP arbitrario o administración de accesos.
Prompt injection no se resuelve solo con una instrucción: schemas, allowlists, autorización y límites.
Minimizar información enviada al proveedor; llamadas sensibles devuelven referencias/payload estructurado reducido.
Logs/auditoría/trazas sin secretos, transcripciones completas o razonamiento.
LangSmith off por defecto; inputs/outputs ocultos y metadata allowlist, incluso en tools anidadas.
Alertas solo para administradores habilitados; validación de destinatarios, no lista libre.
Métricas ajenas no conceden lectura de mensajes.

## Evidencia

Tests negativos: acceso ajeno, JWT revocado, refresh reutilizado, escalamiento indirecto,
último admin, OIDC alterado, replay WebAuthn, OTP expirado, restauración insegura,
doble transferencia, simultáneas, prompt injection, documento eliminado, stream reconectado.
No reportar producción financiera/certificación. Declarar límites de demo.
