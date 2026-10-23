# ADR 0004. RBAC y delegación

- Estado: aceptado el 21 de octubre de 2026.

## Decisión

Los permisos nacen en código y migraciones. No existe API para crearlos. El catálogo y la matriz están en `docs/contratos/permisos.yaml`. Los códigos usan dos puntos. No hay comodín ni barra.

Los cuatro roles base y el gestor de catálogo son roles de sistema e inmutables. Un administrador de accesos puede asignar a otra persona los roles `cliente`, `soporte`, `auditor` y `administrador`. No puede asignarse ningún rol a sí mismo ni editar los permisos de un rol que ya tiene. No puede retirar el último administrador efectivo, tampoco bajo concurrencia.

El gestor no es asignable por ese administrador. Sus permisos de catálogo y de documentos RAG están fuera del conjunto delegable, y asignar el rol no puede saltarse la comprobación permiso por permiso. El usuario gestor inicial llega por seed. Es una limitación consciente: el administrador de accesos no fabrica un operador de catálogo ni un operador financiero.

Un rol personalizado solo puede contener permisos del conjunto delegable definido en el catálogo. Ese conjunto incluye el perfil propio, las capacidades own de cliente, la lectura limitada de soporte, el inicio de recuperación, la auditoría global y la administración de accesos salvo `security:recovery:complete`. Excluye catálogo, documentos RAG, `offers:read:any` y la recuperación completa.

`security:recovery:complete` solo está en el rol de sistema administrador. Aun con el permiso, completar la recuperación responde 422 `RECOVERY_POLICY_DISABLED` hasta existir dos actores distintos. El iniciador no completa. No hay bypass.

`ai:documents:read` y `ai:documents:reindex` quedan en el gestor. La matriz de `docs/05` niega los documentos RAG a los cuatro roles base, y el gestor es el único administrador de contenido. La lectura de eliminados usa `users:read:deleted`, `roles:read:deleted`, `applications:read:deleted`, `categories:read:deleted`, `products:read:deleted` y `offers:read:deleted`. Pedir eliminados sin ese permiso responde 403, no los oculta en silencio.

Alta y baja de asignaciones de oferta comparten `offers:assign`, como indica la tabla de `docs/04`. `offers:read:any` y `audit:read:own` existen para sus rutas y ningún rol inicial los recibe. El auditor consulta por la ruta global.

Tener un permiso no autoriza a delegarlo. El administrador de accesos no recibe cuentas, transferencias, auditoría global ni conversaciones ajenas. Las métricas de IA no abren los mensajes.

## Consecuencias

La fase 3 prueba autoelevación, último administrador, restauración que no devuelve accesos y un rol personalizado con un permiso no delegable. El catálogo de OpenAPI debe usar exactamente estos códigos.
