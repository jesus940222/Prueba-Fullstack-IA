# ADR 0006. RAG y herramientas

- Estado: aceptado el 21 de octubre de 2026.

## Decisión

LangGraph orquesta dentro de infraestructura. El dominio de IA no importa el grafo, el SDK ni los prompts. Las ocho herramientas de `docs/07` son adaptadores hacia casos de uso o APIs, con esquema estricto y permiso propio. No hay SQL, shell, HTTP arbitrario, MCP, contratación ni confirmación autónoma. La gestión de beneficiarios y límites permanece en la UI.

El actor y la sesión se toman de la petición autenticada en cada invocación. No se guardan como token dentro del checkpoint. Un checkpoint no es la fuente de verdad de una transferencia y no contiene secretos. Reanudar el grafo puede repetir nodos; el efecto financiero no está en el nodo anterior a la interrupción. La preparación es idempotente respecto de la propuesta devuelta. La confirmación no forma parte del grafo.

El índice usa documentos versionados de `knowledge/`, todavía no redactados en esta fase. El pipeline valida, normaliza, fragmenta, calcula hash y hace upsert con identificador determinista. Los filtros de audiencia y vigencia se aplican en servidor. Un documento inactivo se excluye aunque la réplica vectorial vaya retrasada. No se indexan cuentas, movimientos, secretos ni chats. Si no hay evidencia, la respuesta es de incertidumbre.

El system prompt y los ejemplos few-shot se versionan con la ejecución. No se pide ni se almacena chain-of-thought. El PDF lo permite solo si aplica; aquí no aplica.

## Consecuencias

La fase 6 implementa el pipeline, el dataset y las pruebas de inyección, documento borrado y confirmación real. Activar OpenAI sigue siendo opt-in y con coste. Los tests de contrato usan un proveedor controlado y no se presentan como evaluación real.
