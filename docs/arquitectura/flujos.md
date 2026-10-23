# Flujos, dueños y fallos

Estos flujos son diseño. Las secuencias están en `docs/flujos/`. Ninguna integración se ha ejecutado.

## Login, SSO y passkey

Acceso es dueño de la identidad, el desafío y la sesión. Google y Microsoft identifican por emisor y sujeto. El correo del proveedor no vincula ni abre sesión por sí solo. El callback distingue login de vinculación mediante el estado emitido para esa intención.

Sin passkey activa, el siguiente paso es un código de correo de un solo uso, con verificador HMAC, cinco intentos y cinco minutos. Esos números son la propuesta configurable de `docs/01`. Con passkey activa, el paso es WebAuthn con verificación de usuario, origen y RP ID exactos, y desafío de un uso. Si la política queda pendiente, la respuesta es `PASSKEY_ENROLLMENT_REQUIRED` y no hay sesión funcional. Un fallo de passkey no cambia a correo.

El código de recuperación no omite la passkey: abre un acceso restringido de recuperación. La recuperación administrativa responde `RECOVERY_POLICY_DISABLED` hasta existir el procedimiento de dos actores. No hay bypass.

OIDC, correo o base no verificables producen 503 y no crean sesión. El desafío vencido, reusado o con intentos agotados produce 422 `CHALLENGE_INVALID`.

## Cambio de permisos

Acceso confirma en una transacción el cambio, el incremento de versión y la revocación de sesiones y refresh de los usuarios afectados. Si el cambio es de un rol compartido, la versión del rol se comprueba en esa misma transacción; no queda una ventana en la que la escritura ya cambió y las sesiones siguen vigentes a la espera de un fanout.

Redis guarda permisos bajo la versión. Si la clave no está, Acceso lee PostgreSQL. Redis caído no autoriza por ausencia ni conserva una decisión positiva vencida.

La carrera entre servicios queda así. Cuentas puede haber recibido un allow antes de la revocación. Esa autorización no se cancela de forma retroactiva ni existe una transacción XA con Acceso. Cuentas vuelve a llamar a authorize inmediatamente antes de tomar los bloqueos del dinero. Si la revocación ya está confirmada, no hay débito y la propuesta de esa sesión queda inutilizable. Si authorize no responde, el resultado es 503 y tampoco hay débito. Un evento `session.revoked` llega después y no sustituye esa comprobación.

Lo que no se promete: abortar una transferencia cuyo segundo authorize ya pasó y cuya transacción local ya confirmó el débito.

## Transferencia

Cuentas es dueño del dinero. La preparación exige cuenta origen propia, beneficiario o número de destino en exclusión mutua, moneda MXN e importe decimal. La respuesta fija los valores. Cambiar el importe crea otra propuesta. La propuesta vence a los cinco minutos propuestos y no reserva saldo.

La confirmación exige cookie de sesión, permiso vigente, verificación reciente, valores idénticos y `Idempotency-Key`. Cuentas bloquea las cuentas en orden de identificador y serializa el acumulado diario del usuario. En la misma transacción escribe débito, crédito, dos movimientos, transferencia, consumo de límite, idempotencia y outbox. El saldo queda en cero o positivo y coincide con los movimientos.

Fondos, límite, moneda o destino inválido rechazan sin movimientos y publican `transfer.rejected` solo después de persistir ese rechazo. Un corte de red se resuelve consultando la propuesta o repitiendo la misma clave. El navegador no muestra éxito optimista.

No hay API pública de reversa en v1. La corrección futura es una transferencia compensatoria, no un update del movimiento.

## Outbox y auditoría

Cada productor guarda el evento en su outbox dentro de la transacción de negocio. Un proceso del mismo servicio lo publica con confirmación. Auditoría valida el esquema, inserta por `event_id` y solo entonces confirma el mensaje. Un duplicado se confirma sin segundo documento. Un fallo recuperable reintenta; al agotarse va a `audit.events.dlq`.

La consulta de auditoría escribe su propio evento en MongoDB y no lo republica. Así no hay bucle. El consumidor de cola solo puede insertar. La API lee y también inserta sus eventos de consulta; no actualiza ni borra.

## Chat y RAG

IA es dueña de la conversación, la ejecución y el índice. Cuentas y Catálogo siguen siendo dueños de sus respuestas. El actor sale de la sesión revalidada, nunca de un argumento del modelo.

`search_documentation` filtra por aplicación, audiencia y documento activo antes de construir el contexto. Un documento borrado deja de entrar aunque Qdrant tarde en reflejarlo, porque IA contrasta los metadatos en su base. No hay ingestión de URLs arbitrarias.

`prepare_transfer` crea la propuesta en Cuentas y el grafo se detiene. La tarjeta sale de esa respuesta. El botón de la UI llama a Cuentas con la clave de idempotencia. El modelo, un documento o la frase "ya confirmé" no ejecutan el débito. Reconectar el stream no relanza el modelo ni la herramienta: se engancha a la ejecución existente. Cancelar o agotar el tiempo no revierte una transferencia ya confirmada.

Sin evidencia, IA responde incertidumbre y fuentes. Sin permiso, rechaza sin filtrar el recurso. Si OpenAI, Qdrant o el presupuesto no son utilizables, la ejecución termina en fallo y el formulario de transferencia sigue disponible.
