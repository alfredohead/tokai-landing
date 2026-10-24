# Política de continuidad de executor (vigente desde 2026-10-23, aprobada por Alfredo)

## Regla
1. Toda tarea material registra su `executor_original`: herramienta/surface, proveedor, modelo, rama o worktree y estado.
2. Si el `executor_original` está verificado, la continuación se hace con ese mismo executor.
3. Si no está disponible (cuota, error, herramienta ausente): DETENERSE, dejar el estado en este registro y pedir autorización explícita a Alfredo. Prohibido sustituir en silencio (sin fallbacks automáticos).
4. Sólo se reemplaza sin consulta si la fila dice `afinidad: ninguna`.
5. Todo override se anota en la sección Overrides (append-only): fecha, de -> a, motivo, aprobador.
6. Lo no verificado se marca `desconocido`; no se infiere.
7. Contrastar con otro modelo (p. ej. Codex) es una revisión de solo lectura, no una continuación, y sólo con autorización.

## Registro de tareas (append-only; más reciente arriba)
| fecha | tarea | executor_original (surface / proveedor / modelo) | rama/worktree | estado | afinidad |
|---|---|---|---|---|---|
| 2026-10-17 | legal: /terminos y privacidad | desconocido (commits "unknown"; convención del repo: Claude Code por CLAUDE.md) | main | DEPLOYED (13e7f6c) | claude (no verificado) |
| 2026-10-14 | captación: /diagnostico y atribución UTM | desconocido (idem) | main | DEPLOYED (2119cc2) | claude (no verificado) |

## Overrides
(ninguno)
