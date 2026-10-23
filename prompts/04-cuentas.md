# Fase 4: Cuentas y transferencias

Implementa Cuentas, sus migraciones y frontend según docs/02 y docs/04 a docs/06.

- Customer distinto de User; vínculo externo sin consultas directas a Acceso DB.
- Account, Money, límites, Beneficiary, TransferProposal/Transfer, Movement.
- Seeds ficticios coherentes y movimientos de apertura.
- Consultas propias, resumen con criterios de gasto definidos, movimientos/historial paginados.
- Beneficiarios CRUD lógico con cursor/search y destinatario ocasional.
- Resolución de destinatario mínima y limitada contra enumeración.
- Límites personales por operación/día, máximos de entorno y día México.
- Propuesta inmutable con expiración y binding sesión/usuario.
- Confirmación UI explícita, verificación reciente y reautorización al ejecutar.
- Idempotencia durable y única por propuesta, incluso claves distintas.
- Lock determinista de cuentas y control concurrente de presupuesto diario.
- Una transacción para débito/crédito, movimientos, consumo, resultado, idempotencia y outbox.
- Eventos no bloquean negocio por caída del broker; publicar luego sin duplicar.
- Comprobante con datos de operación y estado incierto recuperable.
- No exponer reversas, apertura o contratación adicionales sin requerimiento.

Gate:
No saldo negativo ni desbalance al ejecutar solicitudes simultáneas.
Misma solicitud repetida no duplica; misma clave/payload diferente falla.
Dos confirmaciones con claves diferentes no duplican propuesta.
Límite diario correcto en cambio de día/zona y concurrencia.
Usuario ajeno/inactivo/revocado, cuenta cerrada, propuesta expirada y saldo insuficiente rechazados.
Reinicio tras commit antes de publicar conserva transferencia/evento.
Frontend no muestra éxito por timeout ni actualiza saldo optimísticamente.
Unitarios/integración/e2e y cobertura >=70%; evidencia real.
