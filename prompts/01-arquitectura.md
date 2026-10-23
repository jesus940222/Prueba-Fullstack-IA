# Fase 1: arquitectura y contratos

Ejecuta la fase 1 del proyecto definido en AGENTS.md y docs/. Las decisiones de producto ya están tomadas.
No vuelvas a preguntarlas. Los valores provisionales se implementarán configurables y marcados como tales.

Entregables:
- Context map de los cinco bounded contexts, responsabilidades y propiedad de datos.
- Diagrama Mermaid completo con servicios, REST, RabbitMQ, DBs, Redis, Qdrant y proveedores.
  Los .mmd del paquete son diseños iniciales, amplíalos sin atribuir ejecución real.
- Flujo login/SSO/passkey, cambio de permisos, transferencia, outbox/auditoría y chat/RAG.
- Diseño de capas por servicio y sentido de dependencias.
- Agregados, value objects, invariantes, puertos y límites transaccionales; justificar DDD proporcional.
- ADRs de stack, aislamiento, revocación, RBAC/delegación, consistencia, RAG/tools y observabilidad.
- OpenAPI de cada API con rutas exactas (expandir shorthand de la especificación), DTOs,
  permisos, campos allowlist, errores y paginación.
- Schemas versionados de eventos y catálogo canónico de permisos/matriz inicial.
- Lista de variables, validaciones, valores provisionales y dependencias externas.
- Plan de pruebas por riesgo y threat model concreto, sin checklist desconectado del diseño.
- Actualizar trazabilidad de cada requisito del PDF.

No añadir MCP, Kafka, Kubernetes, event sourcing o gateways complejos si no tienen necesidad.
MCP no fue elegido: herramientas mediante APIs en esta versión.
No añadir permisos con slash literal, comodines o escritura libre del catálogo de permisos.
Delegación no puede permitir que el administrador se conceda cualquier capacidad.
Precisar carrera entre autorización y transacción en servicios separados; no prometer atomicidad distribuida.

Gate:
Contratos validan contra especificación; cada endpoint tiene autorización; cada flujo tiene propietario
de reglas/datos y estrategia de fallo. No rutas ambiguas ni scopes inconsistentes.
Validar esquemas/diagramas con herramientas disponibles; informar qué se verificó realmente.
No crear aún toda la aplicación.

Al terminar, informa archivos, decisiones nuevas justificadas, verificaciones, pendientes y gate.
