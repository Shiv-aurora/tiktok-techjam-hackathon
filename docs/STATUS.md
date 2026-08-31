# Status

Current phase: Phase 0 validation plus Phase 1 and the filesystem slice of Phases 2–3  
Current objective: Land and validate control-plane-owned shadow-workspace transactions.

Completed:
- Inspected the supplied Agent Launchpad architecture, execution path, tests, and extension seams.
- Preserved the supplied product vision and implementation plan in `docs/`.
- Added durable transactions linked to every new Run and a version-1-to-version-2 store migration.
- Added isolated shadow workspaces, deterministic filesystem verification, an effect ledger, integrity hashes, commit, abort, rollback, and restart cleanup.
- Added transaction read APIs and matching web-client types.
- Added positive and adversarial tests for safe commit, protected paths, permission changes, unsafe symlinks, hard links, rollback, and migration.
- Added CI and documented the current trust boundary and limitations.

Last verified:
- Local TypeScript syntax transpilation passed.
- Focused TypeScript checks passed for the transaction core, `AgentService`, and web API/types.
- Full repository `npm run check` is pending GitHub Actions on the implementation branch.

Blockers:
- A live Ark/Codex Agent Run requires runtime credentials and a container environment; this does not block deterministic CI validation.

Next:
- Run full CI and correct any repository-level regression.
- Then implement the canonical hidden downstream attack with ZeroCommit disabled/enabled comparison and process/network effect capture.
