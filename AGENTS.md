# Instrucciones del proyecto

## Objetivo y alcance

Construir la prueba Senior Full-Stack Engineer (IA) como portal financiero local de demostración. Leer README.md y docs/ antes de implementar. El PDF original es la fuente de requisitos de evaluación; la especificación consolida el producto acordado. No eliminar requisitos del PDF para reducir trabajo. Registrar contradicciones explícitamente.

No desplegar, publicar, enviar comunicaciones reales ni contratar servicios sin autorización específica. El correo local se captura en un buzón de pruebas. Configurar integraciones no autoriza enviar correos reales de prueba a terceros.

## Arquitectura obligatoria

- Cinco servicios: Acceso, Cuentas, Catálogo, Auditoría e IA.
- NestJS/TypeScript para los cuatro primeros; FastAPI/Python para IA.
- Clean Architecture verificable y DDD proporcional al contexto.
- Dominio puro: sin NestJS, FastAPI, ORM, HTTP, Redis, LangGraph o SDKs.
- Aplicación depende del dominio y puertos; infraestructura implementa puertos.
- Modelos ORM separados de entidades de dominio. No exponer entidades ORM como respuestas HTTP.
- Cada servicio es dueño de sus datos, sus migraciones y su credencial.
- Prohibido acceder directamente a tablas de otro servicio.
- No compartir entidades de negocio entre servicios.
- Reutilizar contratos, no reglas de dominio acopladas.
- La lógica financiera y autorización efectiva nunca quedan a cargo de un LLM.

## Reglas críticas

- PostgreSQL para Acceso/Cuentas/Catálogo/IA; MongoDB para Auditoría; Redis; RabbitMQ; Qdrant.
- Borrado lógico de negocio. Movimientos confirmados y auditoría de solo anexado; reversas explícitas.
- No reactivar credenciales ni asignaciones anteriores al restaurar un usuario.
- Permisos definidos por código y migraciones, nunca creados libremente desde la UI.
- Roles dinámicos con delegación limitada; denegación por defecto y titularidad por recurso.
- Revocar sesiones y refresh tokens de usuarios afectados por cambios de autorización.
- JWT firmado no basta para revocación: comprobar vigencia de sesión y autorización.
- Transferencia interna MXN: atomicidad, concurrencia, fondos, límites e idempotencia.
- Chat prepara; usuario confirma desde UI; Cuentas decide y ejecuta.
- Sin SQL libre, herramientas arbitrarias ni acceso directo de IA a bases ajenas.
- Nunca guardar secretos en frontend, repositorio, checkpoints, logs, auditoría o trazas.
- No conservar razonamiento interno del modelo. Solo respuestas, acciones y evidencia permitida.
- No simular controles de seguridad ni reportar pruebas no ejecutadas.
- No introducir capas CQRS/event sourcing/sagas genéricas por apariencia arquitectónica.

## Trabajo y verificación

Implementar una fase a la vez según prompts/. Priorizar recorridos verticales verificables.
Antes de cada fase: leer contratos relevantes e identificar riesgos.
Después: ejecutar verificaciones, resolver fallos e informar comandos, resultados y limitaciones.
No continuar con fallos relevantes pendientes ni omitirlos silenciosamente.
No pedir permiso para tareas reversibles que ya pertenezcan a la fase autorizada.
No alterar esta especificación para hacer pasar tests.
Usar documentación oficial actual para versiones, APIs y configuraciones. HeroUI v3 no se implementa con ejemplos v2.
Fijar versiones exactas y lockfiles al iniciar; no usar etiquetas latest como contrato reproducible.
Cobertura por servicio >=70% en código propio; exclusiones justificadas.
Tests deben cubrir reglas, contratos y fallos reales, no reflejar mecánicamente la implementación.

## Resultados requeridos

Código, Dockerfiles, Compose, migraciones, seeds, OpenAPI, contratos de eventos, diagrama Mermaid, ADRs, tests y cobertura, documentación RAG/prompts/evaluación, runbook de incidente, evidencia de ejecución y límites conocidos.

No afirmar que la demo cumple certificaciones o está lista para producción financiera.
