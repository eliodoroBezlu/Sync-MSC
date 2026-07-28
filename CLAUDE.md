@AGENTS.md

# Idioma

Responder SIEMPRE en español de Bolivia, en todas las respuestas de esta conversación y sesiones futuras en este proyecto. No responder en inglés salvo que el usuario lo pida explícitamente.

# Deploy y respaldo en git

Cada vez que el usuario pida commitear/subir cambios, después de crear el commit hacer push automáticamente a **ambos** remotos, sin pedir confirmación adicional:

- `externo` (`https://github.com/eliodoroBezlu/Sync-MSC.git`) — dispara el deploy automático en Railway ("eliodoro").
- `origin` (`https://github.com/ovica16/sync-msc.git`) — copia de respaldo en GitHub de ovica.

Comando: `git push externo <rama>` y `git push origin <rama>`.

# Política de subagentes por modelo

Cuando se necesite delegar trabajo a un subagente, usar el modelo según la naturaleza de la tarea:

## claude-haiku-4-5 — Búsqueda y lectura rápida
Usar para:
- Buscar archivos (Glob, Grep)
- Leer archivos para extraer información puntual
- Lookups de símbolos, rutas, tipos
- Tareas de exploración que no escriben código

## claude-sonnet-4-6 — Escritura y código normal
Usar para:
- Implementar funcionalidades nuevas
- Editar o refactorizar código existente
- Crear componentes, rutas de API, modelos
- Corrección de bugs
- Todo trabajo de desarrollo habitual

## claude-opus-4-7 — Revisión de arquitectura y decisiones críticas
Usar únicamente para:
- Evaluar decisiones de arquitectura de alto impacto
- Revisar diseño de esquemas de base de datos antes de migrar
- Análisis de seguridad o rendimiento crítico
- Decisiones que afecten a múltiples módulos simultáneamente
- No usar para tareas de implementación rutinaria
