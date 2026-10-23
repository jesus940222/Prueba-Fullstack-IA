# Prompt inicial para Cursor

Trabajaremos en la prueba técnica adjunta de Senior Full-Stack Engineer (IA).
El repositorio contiene la especificación acordada en README.md, AGENTS.md, .cursor/rules/ y docs/.
Lee esos archivos y el PDF antes de implementar. Si falta el PDF, indícalo y utiliza la matriz
docs/10-trazabilidad-prueba.md como referencia provisional sin afirmar que verificaste el original.

Tu objetivo es implementar un portal financiero de demostración con cinco microservicios independientes:
Acceso, Cuentas, Catálogo, Auditoría e IA. Clean Architecture y DDD son obligatorios y verificables.
Frontend React/TypeScript/HeroUI v3; NestJS/TypeORM para servicios principales; FastAPI/SQLAlchemy/Alembic
para IA; PostgreSQL, MongoDB, Redis, RabbitMQ y Qdrant; Docker Compose completo.

No implementes todo desde una instrucción gigante ni cambies el alcance para simplificar.
Ejecutaremos los prompts de prompts/01 a prompts/07 en orden, con verificaciones por fase.
No hace falta pedir confirmación para decisiones rutinarias reversibles dentro de una fase autorizada.

En este primer paso:
1. Inspecciona el repositorio sin sobrescribir trabajo existente.
2. Lee la especificación completa, identifica contratos y restricciones.
3. Señala contradicciones reales y valores provisionales. No conviertas una propuesta en requisito del PDF.
4. Resume el alcance y los riesgos en no más de una página.
5. Indica qué archivos modificarás en fase 1 y qué fuentes oficiales debes verificar.
6. No generes todavía el código de toda la aplicación ni afirmes que una integración funciona.

No solicites claves secretas por chat: configura variables y documenta cómo proporcionarlas localmente.
No envíes correos reales ni publiques el sistema.
Si el workspace ya contiene implementación, evalúala y adapta los siguientes pasos sin recrearla desde cero.
