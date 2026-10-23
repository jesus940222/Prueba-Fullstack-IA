# Ejercicio 4: diagnóstico de incidente

Escenario: usuarios no guardan registros, algunos servicios devuelven 500 y agentes IA muestran alta latencia.
Este documento es un runbook propuesto, no evidencia de un incidente realmente observado.

## Primeros minutos

Asignar responsable, registrar inicio y alcance; cuantificar qué operación/usuarios/servicios fallan y desde cuándo.
Comprobar cambios/despliegues recientes, salud del gateway y dependencias compartidas.
Prioridad: integridad de operaciones y recuperación de acciones esenciales; evitar reintentos que dupliquen transferencias.
Si resultado de transferencia incierto, consultar por referencia/idempotencia antes de repetir.
Separar síntomas: IA lenta no explica por sí misma fallo transaccional si están desacoplados.

## Hipótesis y evidencia

| Hipótesis | Evidencia a buscar | Acción inicial segura |
|---|---|---|
| PostgreSQL saturado / locks / pool agotado | conexiones, esperas, queries lentas, deadlocks, errores por servicio | acotar tráfico, inspeccionar locks, revisar cambio de índices/consultas/pool |
| Acceso/Redis degradado | latencia de authorize, timeouts, fallos sesión/cache | restaurar dependencia; no abrir acceso por defecto |
| Rabbit caído / consumidores fallan | backlog, outbox pendiente, reintentos, DLQ | recuperar publicación/consumo sin repetir negocio confirmado |
| Red/DNS/timeout entre servicios | trazas correlacionadas, resolución, errores de conexión | comprobar ruta afectada y límites, no subir timeouts globalmente |
| Proveedor IA lento/429 | tiempos separados retrieval/model/tools, rate limits, tokens | limitar concurrencia/contexto, backoff acotado, degradar asistente |
| Qdrant/retrieval lento | filtros/índices, tamaño top-k, duración embeddings | revisar índices/filtros y reducir trabajo acotadamente |
| Regresión de aplicación/migración | correlación con versión, stack seguro, contratos | rollback compatible o fix aislado, sin destruir datos |

No ejecutar cambios destructivos, matar sesiones DB o aumentar pools sin evaluar efecto.

## Diagnóstico sistemático

1. Elegir solicitud fallida y correlation_id; seguir gateway -> servicio -> DB/dependencia/evento.
2. Clasificar 500 por código interno y causa, no solo HTTP.
3. Comparar una solicitud correcta con otra fallida, y versiones antes/después.
4. Separar tiempos: cola, conexión, DB, herramientas, retrieval y proveedor.
5. Verificar CPU/memoria/disco, conexiones y saturación por componente.
6. Identificar timeout original y cascadas/reintentos que multiplican carga.
7. Aplicar mitigación acotada y medir recuperación antes de ampliar.

## Logs centralizados

Producción: recolector de stdout JSON hacia backend de logs centralizado con acceso por rol y retención.
Campos mínimos timestamp, level, service, version, event, correlation_id, run/transfer reference y error_code.
Consulta inicial por ventana de tiempo y correlation_id, luego agregación por servicio/error/versión.
Demo: docker compose logs estructurados permite inspección local; no llamarlo plataforma centralizada si no hay recolector.
Si se implementa perfil opcional Loki/Grafana u otro, documentar recursos, auth y limitaciones.
No buscar usando datos sensibles ni copiar tokens/prompts a herramientas externas.

## IA: latencia y costes

Revisar tokens por ejecución, loops de tools, reintentos, contexto/historial, embeddings repetidos y 429.
Aplicar topes, caché solo de contenido permitido, recuperación más precisa y concurrencia.
Respetar Retry-After cuando exista y backoff con jitter acotado; no reintentar operaciones financieras sin idempotencia.
LangSmith ayuda solo si activado y con datos redactados; métricas locales siguen disponibles.
Aislar o pausar IA no debe impedir transferencias por formulario.

## Comunicación

Ejemplo inicial: "Investigamos errores al guardar y demoras del asistente. Estamos comprobando el estado
de las operaciones antes de recomendar reintentos. Próxima actualización en 15 minutos."
Actualizaciones: alcance confirmado, impacto, hipótesis con evidencia, mitigación, riesgos y próximo hito.
No prometer ETA sin base ni afirmar causa antes de verificar.
Recuperación: resultados de pruebas, backlog pendiente, datos conciliados y monitoreo.
Cierre: cronología, causa validada, factores contribuyentes, acciones y responsables.

## Verificación posterior

Reproducir operación afectada, confirmar ausencia de duplicados, conciliar movimientos/saldos,
revisar cola/outbox/DLQ, comprobar permisos y presupuestos.
Postmortem sin culpas y tests de regresión por causa real.
