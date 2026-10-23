# Dominio proporcional

DDD se usa donde hay invariantes que cruzan objetos. Auditoría y el catálogo de permisos no necesitan agregados tácticos complejos: el permiso es un código versionado por migración y el evento de auditoría es un documento de solo anexado.

No hay CQRS, event sourcing ni una saga para el débito y el crédito. El PDF los admite solo si aplican. Aquí el débito y el crédito ocurren en la misma base de Cuentas.

## Objetos de valor

`Money` guarda un decimal exacto y la moneda, sin punto flotante. `AccountId`, `UserId`, `Email`, `PhoneNumber` y `TransferLimit` validan su forma en el dominio. El teléfono se normaliza a E.164; MX y +52 son predeterminados de captura, no prueba de titularidad. Los identificadores de seguridad reservan el correo normalizado y el par emisor/sujeto aunque el usuario esté eliminado.

## Agregados y puertos

| Agregado | Invariantes que protege | Puerto | Transacción |
|---|---|---|---|
| User | Estado, correo reservado, versión de autorización | Usuarios | Cambio de identidad y revocación de sus sesiones |
| Session | Vigencia, método, versión y revocación | Sesiones y refresh | Rotación de refresh y revocación de familia |
| Role | Permisos del rol y último administrador | Roles y asignaciones | Reemplazo optimista de permisos y revocación |
| Account | Saldo no negativo e igual a sus movimientos | Cuentas | Una cuenta, o las dos cuentas de una transferencia |
| TransferProposal | Inmutable, un dueño, una sesión, un vencimiento | Propuestas | Crear, cancelar o marcar confirmada/rechazada |
| Transfer | Confirmada no se edita; la corrección es otra transferencia | Transferencias y movimientos | Débito, crédito, movimientos, límite diario, idempotencia y outbox |
| Beneficiary | Pertenece a un cliente; borrarlo no reescribe historia | Beneficiarios | Alta, alias o baja lógica |
| Product | Términos versionados; restaurar no reactiva ofertas | Productos | Producto y condiciones |
| Offer | Reglas AND permitidas y audiencia | Ofertas | Oferta, reglas o asignación |
| Conversation | Mensajes propios y borrado lógico | Conversaciones | Mensaje y ejecución asociada |

`TransferService` aplica saldo, moneda, destino y límites. La aplicación abre la unidad de trabajo, ordena los bloqueos y llama a los puertos. Dos agregados `Account` dentro de esa transacción local son el límite transaccional de la transferencia. No hay transacción que abarque Acceso y Cuentas.

Puertos de capacidad, no un CRUD genérico: reloj, identificadores, hash de contraseñas, hash de tokens, bus de salida, índice de conocimiento y autorizador. El autorizador recibe sesión, aplicación, permiso y contexto; devuelve decisión y versión, nunca un usuario afirmado por el cliente.

## Reglas que no viven en el modelo

- La passkey pendiente bloquea la sesión funcional. La activa se exige en contraseña, Google y Microsoft.
- El código de correo no se presenta como segundo factor garantizado.
- La propuesta no reserva fondos. Confirmar vuelve a leer saldo, límites, titularidad y autorización.
- Misma clave de idempotencia y mismo hash devuelven la operación. Otro hash devuelve 409. Otra clave sobre la misma propuesta no crea otra transferencia.
- Una transferencia confirmada consume límite diario. Una reversa, si más adelante existe, no lo repone sola.
- Una salida hacia otra cuenta no es un gasto comercial.
- Una regla de elegibilidad solo usa campos y operadores compilados. Sin SQL ni `eval`.
- Un documento RAG no autoriza, no confirma y no cambia herramientas.
- Borrar una conversación oculta mensajes y retira checkpoints de uso. No borra movimientos ni auditoría.

Los campos concretos siguen en `docs/02-dominio-y-datos.md`. Los DTO públicos están en `docs/openapi/`.
