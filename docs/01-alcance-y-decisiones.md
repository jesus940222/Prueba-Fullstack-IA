# Alcance y decisiones

## Producto confirmado

Portal financiero de demostración con datos ficticios precargados:
- Consulta de cuentas, saldos, movimientos y resumen de gastos.
- Transferencias inmediatas internas MXN entre cuentas propias o de otros clientes del sistema.
- Beneficiarios guardados y destinatarios ocasionales, con guardado opcional explícito.
- Catálogo y ofertas de inversión, préstamos y seguros: solo consulta para clientes.
- Administración autorizada de usuarios, roles, asignaciones, productos y ofertas.
- Auditoría y asistente con RAG y herramientas.
- No contratación, interés comercial, operaciones de inversión, créditos reales, seguros reales, transferencias externas, comisiones o cambio de divisas.
- No directorio de clientes expuesto para elegir destinatarios.

## Stack

Frontend: React + TypeScript + Vite + HeroUI v3; React Hook Form + Zod; React Router; Zustand; TanStack Query.
Frontend tests: Jest + React Testing Library; Playwright para e2e.
Backend principal: NestJS + TypeScript + TypeORM + migraciones.
Auditoría: NestJS + MongoDB con adaptador específico; no forzar TypeORM para Mongo.
IA: FastAPI + Python + SQLAlchemy + Alembic + LangGraph; componentes LangChain útiles sin duplicar orquestación.
LLM y embeddings: OpenAI; modelo de conversación configurable; text-embedding-3-large.
Datos: PostgreSQL por servicio, MongoDB, Redis y Qdrant.
Eventos: RabbitMQ + transactional outbox.
Despliegue local: Docker Compose; proxy; buzón SMTP local.
Observabilidad propia primaria, LangSmith secundario opcional y apagado por defecto.
Elegir versiones soportadas y compatibles desde documentación oficial y fijarlas en lockfiles.

## Servicios / bounded contexts

1. Acceso: aplicaciones, identidades, autenticación, sesiones, RBAC y delegación.
2. Cuentas: clientes, cuentas, beneficiarios, límites y transferencias.
3. Catálogo: productos, ofertas, reglas de elegibilidad y asignaciones.
4. Auditoría: recepción y consulta de eventos.
5. IA: chat, herramientas, RAG, ejecuciones, consumo y alertas.

Cada servicio tiene Dockerfile y despliegue independiente. Contenedores de DB, Redis y broker no cuentan como microservicios de negocio.

## Autenticación y permisos

Métodos: email/contraseña, Google OIDC y Microsoft OIDC.
Sin passkey activa: verificación adicional por email.
Passkey habilitada por administrador: estado pendiente hasta registro y comprobación por el usuario; luego requerida en los tres métodos.
No degradar a email automáticamente al fallar una passkey.
Código email no se presenta como segundo factor independiente garantizado.
Roles iniciales: cliente, soporte, auditor, administrador de accesos.
Roles personalizados CRUD lógico; permisos versionados mediante código/migraciones.
Gestor de catálogo como ejemplo adicional de rol personalizado.
Cambios efectivos de autorización revocan todas las sesiones afectadas.
Administrador puede consultar métricas IA ajenas y gestionar alertas, sin acceso automático a conversaciones o cuentas ajenas.

## Conservación

Borrado lógico en entidades de negocio. Cuentas se cierran con reglas, no se ocultan para eludir obligaciones.
Movimientos y transferencias confirmadas no se editan ni eliminan; correcciones compensatorias.
Auditoría inmutable desde aplicación.
Credenciales y sesiones revocadas no se reactivan al restaurar usuario.
Cachés, tokens temporales y desafíos tienen expiración; no son archivo histórico.
No prometer borrado físico de datos personales cuando solo se aplica borrado lógico.

## Configuración provisional (no requisitos literales del PDF)

| Variable conceptual | Valor inicial propuesto |
|---|---|
| Moneda / zona del día financiero | MXN / America/Mexico_City |
| Límite por operación / diario de usuario | 10000.00 / 10000.00 MXN |
| Máximo personal configurable por operación / diario | 50000.00 / 100000.00 MXN |
| Propuesta de transferencia | 5 minutos |
| Verificación reciente para acción sensible | 5 minutos |
| Access token | 10 minutos |
| Sesión absoluta / inactividad | 8 horas / 30 minutos |
| Código email / intentos | 5 minutos / 5 intentos |
| Página o lote por defecto / máximo | 20 / 100 por página; 20 / 50 por cursor |
| Presupuesto IA por ejecución / usuario-día / global-día | 1.00 / 5.00 / 25.00 USD, propuesta de demo |
| Aviso de presupuesto / cooldown | 80% y 100% / 30 minutos, propuesta de demo |
| Pasos de agente / timeout de ejecución | 8 / 60 segundos, ajustables tras medición |

Duraciones en variables con unidad explícita y validadas al iniciar.
Expiraciones emitidas no se extienden al cambiar entorno.
Consistencia: límite por operación <= diario; máximos positivos; rechazar configuraciones inválidas.
Subir límites exige verificación reciente y auditoría.
Presupuestos, tarifas por modelo y límites de salida se versionan; coste desconocido no equivale a cero.
Un límite de coste estimado no garantiza un tope exacto en la factura externa por concurrencia/medición tardía; documentar reservas, margen y límites del proveedor.

## Decisiones abiertas, sin bloquear el inicio

- Modelo exacto de conversación: verificar disponibilidad, herramientas, calidad y coste.
- Qué cuentas Microsoft admitir: fijar explícitamente tenant/issuers permitidos antes de integración real.
- Nombre y estilo visual de la marca: usar identidad sobria de demostración.
- Valores provisionales requieren revisión antes de uso real; no reducir el alcance confirmado para ajustarse a ellos.
