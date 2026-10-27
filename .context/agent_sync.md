# Handoff entre agentes (live, más reciente arriba)

Leer antes `EXECUTOR_POLICY.md`. Cada sesión material agrega una entrada: intent, archivos, estado de deploy (DEPLOYED / COMMITTED-NOT-DEPLOYED / LOCAL-ONLY), executor usado, próximos pasos.

## 2026-10-27 - Corrección de estado: commit de continuidad
- Intent: registrar que el commit 0e8fbcd "chore: enforce executor continuity controls" dejó las políticas de continuidad de executor en estado COMMITTED-NOT-DEPLOYED. Corrige solo el estado de la entrada previa "Addendum de roles y autorizaciones" (LOCAL-ONLY → COMMITTED-NOT-DEPLOYED); la entrada previa no se edita.
- Files: .context/agent_sync.md (nueva entrada). Sin otros archivos.
- Registro: repo tokai-landing; rama main; base/HEAD 0e8fbcd; worker Claude Code (Opus 5.5); revisor ninguno; estado COMMITTED-NOT-DEPLOYED; deploy_autorizado=false.
- Deploy: COMMITTED-NOT-DEPLOYED (0e8fbcd sin push ni deploy).
- Next: push/deploy sólo con OK textual de Alfredo.

## 2026-10-27 - Addendum de roles y autorizaciones
- Intent: agregar Addendum 2026-10-27 a EXECUTOR_POLICY.md (Hermes router, Claude Code único worker, Codex sólo revisión read-only autorizada, gates de OK textual de Alfredo).
- Files: .context/EXECUTOR_POLICY.md (append), .context/agent_sync.md (append). Sin otros archivos.
- Registro: repo tokai-landing; worktree C:\Users\ProNac2\Downloads\Proyectos\Tokai\tokai-landing; rama main; base/HEAD 2c6fe1c; worker Claude Code (Opus 5.5); revisor ninguno; estado LOCAL-ONLY; deploy_autorizado=false.
- Deploy: LOCAL-ONLY (docs; sin commit, push ni deploy).
- Checks: git diff --check OK; diff limitado a appends en ambos archivos.
- Next: revisión de Alfredo y, con su OK textual, commit.

## 2026-10-23 - Hermes hub / Política de executor
- Intent: crear registro de continuidad de executor y ledger de handoff.
- Files: .context/EXECUTOR_POLICY.md, .context/agent_sync.md (nuevos, sin commitear).
- Deploy: LOCAL-ONLY (docs; no afecta runtime).
- Next: commitear con OK de Alfredo.
