# Status

Current phase: Phase 0 validated; Phase 1 and the filesystem slice of Phases 2–3 complete  
Current objective: Begin the canonical hidden downstream attack and process/network effect capture.

Completed:
- Inspected and validated the supplied Agent Launchpad architecture, execution path, tests, and extension seams.
- Preserved the supplied ZeroCommit vision and implementation plan in `docs/`.
- Added durable transactions linked to every new Run and a version-1-to-version-2 store migration.
- Added isolated shadow workspaces, deterministic filesystem verification, an effect ledger, integrity hashes, control-plane-owned commit, abort, rollback, and restart recovery.
- Hardened workspace and journal path validation, missing-artifact recovery, cleanup locking, and fail-closed cancellation and restart paths.
- Added transaction read APIs and matching web-client types.
- Added positive and adversarial tests plus clean-install CI.
- Documented the current trust boundary and limitations.

Last verified:
- `npm run check` passed on Node.js 22 in GitHub Actions from a clean `npm ci` at commit `2f30111d2865a8512c7878a1455b9372bf6cee2c`.
- The check covered server and web typechecking, the complete automated test suite, and the production build.
- Focused runtime smoke tests proved safe commit and unchanged real-state hashes after rejected permission, symlink, hard-link, cleanup-race, and recovery-tampering scenarios.
- PR #1 is mergeable and contains only the intended ZeroCommit transaction-foundation milestone.

Blockers:
- A live Ark/Codex Agent Run requires runtime credentials and a container environment; deterministic transaction behavior is validated without them.

Next:
- Implement the canonical hidden downstream attack with ZeroCommit disabled/enabled comparison.
- Capture the process and network effects required to explain and verify that scenario.
