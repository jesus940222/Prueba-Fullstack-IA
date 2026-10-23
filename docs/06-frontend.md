# Frontend

## Stack y módulos

React/TypeScript/Vite, HeroUI v3, React Hook Form + zodResolver + Zod.
React Router; TanStack Query para servidor; Zustand solo interfaz compartida y contexto mínimo.
Jest/React Testing Library y Playwright. No cambiar a Vitest sin decisión documentada que respete requisito.
No usar API/estilos HeroUI v2. Fijar dependencias compatibles después de verificar docs oficiales.

Módulos:
- Acceso: password/Google/Microsoft, OTP, passkey alta/login, recuperación y vinculación.
- Inicio: saldo, resumen financiero, últimos movimientos y ofertas.
- Cuentas: listado, detalle, filtros e historial.
- Transferencias: origen, beneficiario o destino ocasional, importe, revisión, confirmación y comprobante.
- Beneficiarios: búsqueda infinita y CRUD lógico.
- Catálogo: productos/ofertas, condiciones y elegibilidad.
- Perfil: teléfono, tema, límites, passkeys y sesiones.
- Administración: usuarios, roles, permisos/asignaciones, catálogo según autorización.
- Auditoría: eventos filtrados, detalle y correlación.
- Chat: mensajes, herramientas, fuentes, confirmación y métricas.
- IA administrativa: métricas de todos, filtros, presupuestos, reglas y alertas.

Rutas y menú por permisos; backend siempre autoriza. Acceso directo por URL no elude restricciones.
No UI de contratación o registro de interés.

## URL y formularios

URL como fuente de verdad de filtros/orden/page/pageSize en listados.
Zod para params UUID y query: coerción controlada, límites, fechas coherentes, allowlist sort, defaults.
Ejemplo: /cuentas/:accountId/movimientos?page=1&pageSize=20&type=debit
IDs malformados => no consultar backend; filtros inválidos => normalizar o mostrar error según contrato.
Cambio de búsqueda/filtro resetea página; back/forward y reload conservan estado.
No query con secretos, tokens, claves OTP o borradores financieros.
Solo destinos internos permitidos para returnTo.
No z.coerce.boolean genérico que interprete "false" como true: parseo explícito.

RHF maneja formulario; Zod valida y produce tipos; Controller/adaptador si HeroUI lo necesita.
Mensajes por campo y errores de servidor; evitar campos que el usuario no puede editar.
Importe como string decimal, sin parseFloat ni aritmética flotante; servidor decide fondos/límites.
No validación de elegibilidad o permiso solo del lado cliente.

## Paginación

Tablas: páginas con total, tamaño, filtros y orden en URL.
Selectores beneficiarios: cursor + search, debounce, cancelar consultas obsoletas,
cargar más al acercarse al final y botón accesible alternativo.
Solo beneficiarios propios; no listado de clientes global.
Query keys incluyen contexto usuario/aplicación, filtros, orden y paginación.
Evitar duplicados por ID; no asumir que cada cursor representa snapshot inmutable.
Al cerrar sesión, borrar caché sensible para no mostrar datos del usuario previo.

## UX

Loading inicial, adicional y skeletons; vacíos, error con retry seguro y éxito explícito.
Transferencia pendiente de comprobar tras corte de red; recuperar estado antes de otro intento.
No actualización optimista de saldos ni "éxito" basado en texto del modelo.
Confirmación visual de origen/destino/importe/concepto/expiración; botón real en chat y formulario.
No "sí" en texto como ejecución autónoma.
Confirmación bloqueada tras vencer propuesta o cambiar sesión; datos modificados exigen nueva propuesta.
Comprobante solo con transferencia confirmada.

HeroUI tema light/dark/system; guardar preferencia, respetar sistema, evitar destellos y comprobar contraste.
Español es-MX, importes MXN explícitos y zona México para presentación.
Responsive, teclado, foco modal, etiquetas, mensajes accesibles y estados anunciados.

## IA visible

Por respuesta/run: tiempo total, primer contenido si existe, tokens entrada/salida/caché/total,
coste estimado USD, modelo, fecha/tarifa, estado y referencia.
Resumen discreto + panel expandible. Si usage incompleto, etiqueta; no cero inventado.
Quien tiene `accounts:read:own` y no tiene `ai:metrics:read:any` (cliente) no ve el panel de coste en el chat. La API sigue exigiendo `ai:metrics:read:own`. Las referencias van en un panel cerrado, igual que las métricas cuando sí se muestran.
El mensaje del usuario entra en la conversación al enviarlo, antes de que responda el asistente.
Embeddings de indexación separados del coste de una respuesta; sumar retrieval embedding si lo genera.
Admin: agregados, usuario, fecha, modelo, estado, alertas y acknowledgement.
No contenido de conversaciones ajenas.

## Sesión y transporte

Cookies y CSRF según docs/05. Ningún secreto VITE_*; estas variables se publican en bundle.
OpenAI/Google/Microsoft secretos solo backend.
401 limpia UI/caché y pide login; 403 muestra restricción; 503 no falsea logout definitivo.
SSE/stream autenticado sin tokens de URL, reconexión a run existente.
Markdown sanitizado. No HTML arbitrario de mensajes/documentos.

## Tests mínimos

Formularios válidos/incorrectos y errores backend; URL inválida y navegación,
acceso denegado, carga/error/vacío, cursor y teclado, ambos temas,
revocación/limpieza de caché, confirmación y resultado incierto, métricas incompletas.
Proxy permite recargar deep links sin 404.
