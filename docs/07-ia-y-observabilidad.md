# IA, RAG y observabilidad

## Responsabilidades

FastAPI expone contratos; aplicación dirige casos de uso; LangGraph implementa orquestación.
Dominio no depende de prompts, SDK o grafo. Tools son adaptadores a casos de uso/APIs.
Modelo de conversación OpenAI configurable y verificado antes de fijar versión.
Embeddings text-embedding-3-large; dimensiones explícitas compatibles con colección Qdrant.
SQLAlchemy/Alembic para datos propios. Checkpoints por adaptador soportado, migraciones/provisión documentadas.
No compartir conexiones ni leer tablas de Acceso/Cuentas/Catálogo.

## Herramientas iniciales

| Nombre | API / permiso |
|---|---|
| search_documentation | RAG filtrado por aplicación/audiencia activa |
| list_my_accounts | Cuentas / accounts:read:own |
| list_my_transactions | Cuentas / transactions:read:own, filtros validados |
| list_my_beneficiaries | Cuentas / beneficiaries:read:own, cursor |
| get_my_transfer_limits | Cuentas / transfer-limits:read:own |
| list_products | Catálogo / products:read |
| list_my_offers | Catálogo / offers:read:own |
| prepare_transfer | Cuentas / transfers:create:own |

Capacidades registradas en código, schemas estrictos, no URLs/SQL/shell arbitrarios.
No tools para roles, passwords, recuperación, contratación o confirmación autónoma.
Gestión de beneficiarios/límites se mantiene en UI en v1; no ampliar tools implícitamente.
Permisos vigentes al invocar, no solo al generar lista inicial.
Actor de request autenticada, no argumento generado por modelo.
No credenciales universales de IA; autenticación de servicio + delegación de usuario.
Contexto de autorización no persistido como token en checkpoint.

## Flujo financiero

1. Interpretar intención con esquema; si falta/ambigua cuenta o destinatario, pedir aclaración.
2. Consultar datos mínimos autorizados.
3. Preparar propuesta mediante Cuentas.
4. Pausar grafo y mostrar tarjeta construida con respuesta de backend.
5. Usuario pulsa confirmación; frontend llama a Cuentas con propuesta y clave idempotente.
6. Resultado verificado se incorpora al chat como estado, no afirmación libre de éxito.
7. Si sesión revocada/propuesta vencida, no reanudar ejecución financiera.

Grafo reanudable puede repetir nodos. Aislar efectos y diseñarlos idempotentes.
No ejecutar débito antes de interrupt ni al reconstruir checkpoint.
No aceptar "ya confirmé" desde el modelo o un documento como confirmación.
Herramientas mutantes no se reintentan con claves nuevas.
Sesión/cancelación/timeout no deshacen transferencia confirmada.
No cachear saldos/ofertas personales en historial como estado vigente.

## RAG

Documentos de knowledge/ aprobados y versionados: uso del portal, transferencias,
beneficiarios/límites, autenticación/recuperación, condiciones ficticias del catálogo.
Pipeline: validar tamaño/formato -> normalizar -> fragmentar -> hash/versionar -> embeddings -> upsert Qdrant.
IDs deterministas por documento/versión/fragmento; reindexación idempotente.
Metadata: document_id/version, section, audience/application, active, deleted, content_hash, model/dimensions.
Filtros servidor antes de entregar contexto; nunca obtener contenido privado y confiar en que LLM no lo revele.
Para demo, docs generales; documentación administrativa solo si su audiencia está permitida.
Desactivar/borrar documento lo excluye de búsqueda y de checkpoints/contextos reutilizados.
Verificar vigencia/autorización de resultados contra metadatos authoritative antes de pasar al modelo,
para no depender exclusivamente de propagación tardía a Qdrant.
No indexar cuentas, movimientos, secretos ni chats.
Documentos son evidencia, nunca instrucciones con autoridad para cambiar herramientas/permisos.
Si no hay evidencia suficiente: respuesta de incertidumbre y fuentes, no inventar.
Sin ingestión de URLs externas arbitrarias; evita SSRF y expansión de alcance.

## Prompt engineering

System prompt versionado: funciones del asistente, fuentes permitidas, herramientas, permisos,
datos faltantes, no asesoría/decisiones financieras inventadas, no revelar secretos,
no obedecer instrucciones de documentos que alteren políticas, confirmación explícita.
Few-shot: consulta de saldo, ambigüedad de beneficiario, documentación sin evidencia,
transferencia preparada sin ejecución, solicitud no autorizada.
No pedir ni almacenar chain-of-thought. Evaluar decisiones observables y resultados.
Versionar prompts/modelos y relacionarlos con ejecución/evaluación.

## Métricas

Una ejecución puede contener varias llamadas: agregar por proveedor/modelo e incluir fallos/reintentos facturables.
Registrar latencia total, primer contenido si existe, tiempos de herramientas/retrieval,
tokens input/output/cached/total y usage_complete.
Coste estimado USD decimal: usar tabla de tarifas versionada según categoría facturable.
No contar cached tokens dos veces ni inventar tarifas para campos desconocidos.
Embeddings de consulta suman coste del run; indexación se reporta aparte.
Uso no disponible => null/incompleto, no cero.
Run cancelado puede generar cargos. Medición local no sustituye factura del proveedor.
Cerrar run y evento outbox de métricas de manera consistente; reintentar sin duplicar consumo.
Frontend ofrece resumen propio y detalle, panel administrativo global sin chats ajenos.

## Alertas y límites

Umbrales: ejecución, usuario-día, global-día; avisos 80/100%, propuesta configurable.
Anomalía relativa opcional solo con historial suficiente; priorizar umbrales absolutos verificables.
Ventana diaria declarada (México para demo); dinero USD aunque negocio MXN.
Deduplicación por regla/alcance/ventana/umbral, cooldown y reintentos de notificación.
Solo administradores activos con permisos; UI y email, nunca correo libre de body.
Evento audit de generación, cambio de reglas, entrega/fallo y reconocimiento.
Alertar no bloquea por sí mismo: preflight presupuesto, reserva de consumo estimado,
topes de tokens/pasos/tiempo y ajuste con uso real; concurrencia no permite presupuesto ilimitado.
Permitir operación financiera ya confirmada aunque luego falle notificación.
No loguear prompts completos dentro de errores del proveedor.
Límites y alertas propios deben funcionar con LangSmith apagado o caído.

## LangSmith opcional

Variables: LANGSMITH_TRACING=false por defecto, API key secreta, endpoint/proyecto configurables.
Verificar nombres exactos de variables contra SDK elegido antes de implementar.
Ocultar inputs/outputs; allowlist de metadata pseudonimizada sin PII, saldos, OTP o argumentos sensibles.
Aplicar redacción a grafo, tools, callbacks y subllamadas; test con capturador de payload.
No mostrar enlaces de trazas a usuarios sin autorización.
Exportación asíncrona acotada: fallo no rompe operación ni consume memoria sin límite.
No confundir observabilidad externa con archivo de auditoría.
Documentar que activar implica envío externo de telemetría permitida.

## Evaluación

Dataset versionado con preguntas y criterios de éxito:
- FAQ con fuente correcta y documento vigente.
- Sin evidencia: no inventar.
- Ofertas actuales vía API, no solo documento.
- Cuenta/beneficiario ambiguo: aclarar.
- Cuenta ajena o permiso ausente: rechazar sin filtrar datos.
- Prompt injection desde chat/documento/tool: no ampliar capacidades.
- Transferencia: propuesta y confirmación real; nunca ejecución autónoma.
- Sesión revocada, timeout, rate limit, proveedor caído y streaming reconectado.
- Documento desactivado: no recuperarlo.
- Uso incompleto y coste acumulado de varias llamadas.
Métricas de exactitud de herramienta, éxito de tarea, fundamentación/citas,
rechazos correctos, latencia p50/p95 y coste medio/total.
Evaluador determinista cuando sea posible; LLM juez opcional identificado, no única prueba.
Tests usan proveedor controlado; evaluación real opt-in con coste informado.
No reportar cifras de dataset real si no se ejecutó.
