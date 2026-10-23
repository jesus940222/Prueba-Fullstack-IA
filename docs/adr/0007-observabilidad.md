# ADR 0007. Observabilidad y alertas

- Estado: aceptado el 21 de octubre de 2026.

## Decisión

La observabilidad primaria es local. Cada servicio escribe logs JSON a stdout con marca de tiempo, nivel, servicio, versión, evento, `correlation_id` y código de error. No entran secretos, OTP, prompts completos, razonamiento ni transcripciones. En la demo, `docker compose logs` es la inspección disponible. No se llama plataforma centralizada mientras no exista un recolector. Loki o Grafana solo podrían añadirse como perfil opcional y documentado; no hacen falta para cumplir esta fase.

Cada ejecución de IA agrega llamadas, reintentos facturables, latencia, primer contenido si existe, tokens de entrada, salida, caché y total, y `usage_complete`. El coste es un decimal estimado con la tarifa versionada. Un uso ausente queda nulo, no cero. Los embeddings de indexación no se suman al coste de una respuesta; los de retrieval sí. Un límite local no es la factura del proveedor: hay reserva previa, ajuste con el uso real y margen, porque la concurrencia y la medición tardía impiden un tope exacto.

Las alertas cubren ejecución, usuario-día y global-día, al 80 % y al 100 %, con cooldown de 30 minutos. Esos valores son la propuesta de demostración. Alertar no bloquea por sí mismo; el preflight de presupuesto sí impide empezar una ejecución que no cabe. Una transferencia ya confirmada sigue confirmada aunque falle el correo de alerta. El destinatario es un administrador validado, nunca un correo libre del cuerpo.

LangSmith queda apagado con `LANGSMITH_TRACING=false`. También se reconocen `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT`, `LANGSMITH_PROJECT` y `LANGSMITH_WORKSPACE_ID`, que son los nombres vigentes de la guía oficial. Si se enciende, inputs y outputs quedan ocultos y la metadata es una allowlist sin PII, saldos ni argumentos sensibles, también en herramientas anidadas. Su fallo no tumba la operación. No sustituye a la auditoría.

## Consecuencias

La fase 6 prueba coste incompleto, varias llamadas, alerta duplicada, destinatario no administrador, LangSmith apagado y un capturador de traza. El runbook de incidente sigue en `docs/09` como procedimiento propuesto, no como evidencia de un incidente observado.
