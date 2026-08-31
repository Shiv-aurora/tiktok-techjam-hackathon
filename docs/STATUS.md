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
- Squash-merged PR #1 into `main` as commit `a8aea7f616b8f92aa970223a51cc42fd72f2bdd8`.

Last verified:
- `npm run check` passed on Node.js 22 in GitHub Actions from a clean `npm ci` at the final PR head `b278a469a41cca711fb75eb01c9bb000c7abc0fc`.
- The check covered server and web typechecking, the complete automated test suite, and the production build.
- Focused runtime smoke tests proved safe commit and unchanged real-state hashes after rejected permission, symlink, hard-link, cleanup-race, and recovery-tampering scenarios.
- The merged change set contains only the intended 20-file ZeroCommit transaction-foundation milestone.

Blockers:
- A live Ark/Codex Agent Run requires runtime credentials and a container environment; deterministic transaction behavior is validated without them.

Next:
- Implement the canonical hidden downstream attack with ZeroCommit disabled/enabled comparison.
- Capture the process and network effects required to explain and verify that scenario.
