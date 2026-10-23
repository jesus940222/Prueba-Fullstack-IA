# ADR 0005. Consistencia de la transferencia

- Estado: aceptado el 21 de octubre de 2026.

## Decisión

La transferencia interna MXN es una transacción local de Cuentas. Entra en ella el bloqueo de las dos cuentas, en orden de UUID; el bloqueo del acumulado diario del usuario; el débito; el crédito; los dos movimientos; la transferencia; la idempotencia y el outbox. El saldo se guarda en `NUMERIC(18,2)`, viaja como string decimal y no se calcula con punto flotante. No se autoriza gasto con un saldo cacheado.

La propuesta es otro agregado, inmutable y sin reserva de fondos. Confirmarla repite autorización, titularidad, destino activo, moneda, saldo y límites. La misma clave e igual hash devuelven el mismo resultado. Un hash distinto devuelve 409. Una segunda clave para la misma propuesta no crea otro movimiento.

El límite por operación no puede superar el diario. Ambos son positivos y no superan el techo configurable. Subirlos exige verificación reciente y auditoría. Lo confirmado consume el diario; la reversa no lo repone sola. En v1 no hay endpoint de reversa.

Si el commit ocurre y el proceso muere antes de publicar, el outbox sigue pendiente y el dinero no se repite. Rabbit puede duplicar o reordenar. Auditoría deduplica por `event_id`.

## Consecuencias

Las pruebas de la fase 4 cubren saldo insuficiente, carreras, reinicio entre commit y publicación, y dos claves para una propuesta. No se introduce una saga. El éxito visible solo llega de la respuesta de Cuentas, nunca del texto del modelo.
