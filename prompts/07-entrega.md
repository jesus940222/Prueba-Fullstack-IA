# Fase 7: verificación final, documentación y entrega

Consolida una entrega revisable de todo lo implementado.

1. Comparar implementación y PDF contra docs/10; no marcar requisito cumplido sin evidencia.
2. Verificar Clean Architecture con imports y ejemplos: dominio puro, ORM separado,
   casos de uso, agregados/invariantes, puertos y eventos. Corregir violaciones.
3. Ejecutar entorno desde un estado limpio aislado, migraciones, seed idempotente y documentación RAG.
4. Ejecutar build/typecheck/lint, unitarios, integración y e2e; generar cobertura real por servicio.
5. Probar recorridos de cliente, soporte, auditor, administrador y gestor personalizado.
6. Probar seguridad negativa, revocación, simultáneas, idempotencia, broker/DB/proveedor fallidos.
7. Revisar exposición de puertos, secretos, imágenes/dependencias y telemetría.
8. Medir IA y comprobar evaluación/alertas, con proveedor real solo si existe configuración autorizada.
9. Completar README con comandos reales, variables, bootstrap, credenciales de demo seguras,
   perfiles, limitaciones, pruebas y pasos de Google/Microsoft/passkeys.
10. Actualizar diagramas/ADRs/OpenAPI/eventos/matriz y docs de RAG/prompts/costes.
11. Entregar respuesta de ejercicio 4 usando docs/09: hipótesis, evidencia, mitigación,
    logs centralizados y comunicación a stakeholders.
12. Registrar pruebas pendientes por falta de infraestructura/credenciales como pendientes, no aprobadas.
13. Crear resumen final de requisitos, evidencia, limitaciones y reproducción.

No subir secretos, no publicar sitio/repositorio, no enviar correos reales ni borrar volúmenes del usuario.
No crear informes de coverage falsos. No sustituir e2e por capturas estáticas.
No afirmar que está listo para producción o certificado financiero.
Si un gate está bloqueado, explicar impacto y qué falta sin esconderlo.
Al terminar: resumen concreto de lo implementado, cómo levantarlo, qué se probó y riesgos restantes.
