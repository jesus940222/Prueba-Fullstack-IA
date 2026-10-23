# Respuesta al ejercicio 4

Esto es el ejercicio de diagnóstico pedido por la prueba. No es el informe de un incidente ocurrido en este entorno. El 21 de octubre de 2026 los cinco servicios del proyecto `guia-portal` estaban healthy y las rutas de readiness respondían 200. Los síntomas de abajo son el escenario de `docs/09-diagnostico.md`: usuarios que no guardan registros, respuestas 500 y un asistente lento.

## Apertura

Inicio registrado al recibir el escenario. Responsable de la demostración: quien opera el entorno local. Alcance inicial: operaciones de guardado, errores 500 y latencia del asistente. No se recomienda reintentar una transferencia hasta consultar su referencia o su clave de idempotencia. El asistente lento no explica, por sí solo, un fallo de Cuentas: la confirmación vive en Cuentas y el chat solo prepara.

## Hipótesis, en el orden en que se mirarían aquí

| Orden | Hipótesis | Qué se puede mirar en esta demo | Mitigación segura |
|---|---|---|---|
| 1 | PostgreSQL sin conexiones o con bloqueos | `docker compose logs` de Acceso, Cuentas, Catálogo e IA. Readiness: el chequeo `postgres` pasa de `up` a fallo y el servicio deja de estar ready. | No ampliar el pool a ciegas. Identificar la base afectada. Las cuatro bases no se consultan entre sí. |
| 2 | Acceso no puede autorizar | Latencia o 503 de `POST /internal/v1/access/authorize`, visible solo dentro de la red. El gateway responde 404 en `/internal/`. Redis puede caer y Acceso sigue leyendo la sesión en Postgres. | No abrir permisos por defecto. Si authorize no responde, la operación protegida debe quedar en 503. |
| 3 | Rabbit o el consumidor de Auditoría | Cola `audit.events`, carta `audit.events.dlq` y filas de outbox con `published_at` nulo. El negocio ya confirmado no se vuelve a ejecutar al republicar. | Recuperar el consumidor. Un `event_id` repetido no crea otra fila en Mongo. |
| 4 | Red entre servicios | El mismo `correlationId` en el log del gateway y del servicio. Un 502 del gateway con el contenedor unhealthy ya ocurrió en una espera antigua a `/services/access/ready`; no es el estado healthy de esta entrega. | Corregir la ruta afectada. No subir todos los timeouts. |
| 5 | Proveedor de IA lento o limitado | Ejecuciones en `ai_records`: latencia, pasos, tokens y coste. Una ejecución que agota los 8 pasos queda failed con coste, no como éxito. Un uso ausente queda en null, no en cero. | Bajar concurrencia (`AI_MAX_CONCURRENCY`) y dejar el formulario de transferencia disponible. |
| 6 | Qdrant lento | Readiness de IA marca `qdrant`. La colección `knowledge` es solo documentación. | Reducir el trabajo de retrieval. No inventar una respuesta sin fuente. |
| 7 | Regresión de migración | El trabajo de migración imprime `applied`. Repetirlo en este volumen devolvió listas vacías o `head` y no duplicó usuarios, cuentas, productos ni documentos. | No borrar volúmenes para “arreglar” un esquema. |

## Cómo se seguiría una solicitud

1. Tomar el `correlationId` del log JSON. Los campos que ya emite el código son `timestamp`, `level`, `service`, `version`, `event` y `correlationId`, más `statusCode`, `method` y `path` en una petición HTTP. No se registra la contraseña ni el prompt.
2. Separar el 500 por código interno. Los contratos usan códigos como `DEPENDENCY_UNAVAILABLE` y `RESOURCE_NOT_VISIBLE`, no solo el HTTP.
3. Comparar una petición sana con la fallida. Hoy, `/health` del gateway responde 200 y las readiness de los cinco servicios responden 200 con sus dependencias en `up`.
4. Separar tiempos de cola, base, herramienta, retrieval y proveedor. Esas duraciones viven en la ejecución de IA, no en un APM externo.
5. Mirar CPU, memoria y conexiones del contenedor afectado con `docker stats` sobre ese servicio, no sobre todo el host a la vez.
6. Buscar el timeout original antes de subir reintentos. Reintentar una transferencia sin la misma clave puede duplicar el débito. La UI conserva la clave si el resultado es incierto.
7. Medir de nuevo la misma operación antes de ampliar la mitigación.

## Logs

No hay Loki, Grafana ni otro recolector. `docker compose logs` es la inspección local. Llamarlo plataforma centralizada sería falso.

Ejemplo real de forma, tomado de una prueba de readiness, sin secretos:

```json
{"timestamp":"2026-10-22T00:56:12.585Z","level":"info","service":"unknown","version":"0.2.0","event":"request","correlationId":"bcf8a1e2-57ff-4a62-be62-d41230e961a3","statusCode":503,"method":"GET","path":"/ready"}
```

La consulta inicial sería por ventana de tiempo y `correlationId`. No se copian tokens, códigos de correo ni prompts a una herramienta externa. LangSmith, si se activara, enviaría telemetría redactada fuera de la máquina. En esta entrega `LANGSMITH_TRACING` es `false`.

## Comunicación de ejercicio

Texto inicial, como ejercicio y no como aviso enviado a nadie:

"Investigamos errores al guardar y demoras del asistente. Estamos comprobando el estado de las operaciones antes de recomendar reintentos. La próxima actualización es en 15 minutos."

Actualización, todavía sin causa única porque el escenario no dejó una traza fallida que compartir:

"El portal local responde en sus comprobaciones de salud. No hay una causa confirmada para el escenario planteado. No reintentes una transferencia si no tienes su referencia. El asistente puede degradarse sin bloquear el formulario de cuentas."

Cierre que solo sería válido si una causa quedara demostrada: cronología, causa, factores, corrección y prueba de regresión. Hoy ese cierre no se redacta como hecho, porque el incidente no ocurrió.

## Después de una recuperación real

Se repetiría la operación, se comprobaría que no hay dos transferencias para la misma clave, se conciliarían saldos y movimientos, y se revisarían outbox, `audit.events` y `audit.events.dlq`. En la última lectura de esta demo, repetir las migraciones dejó 5 usuarios, 3 clientes, 9 movimientos, 5 productos y 5 documentos de IA.
