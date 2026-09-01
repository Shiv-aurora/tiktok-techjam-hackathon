# Status

Current phase: Filesystem transaction foundation complete; scenario-scoped Phase 3 runtime ledger and Phase 4 flagship attack complete  
Current objective: Implement automatic abort → clean recovery → rerun → legitimate task commit.

Completed:
- Preserved the supplied ZeroCommit vision and implementation plan and validated the Agent Launchpad extension points.
- Added durable transactions, isolated shadow workspaces, deterministic filesystem verification, effect evidence, control-plane-owned commit/abort, rollback, restart recovery, and transaction APIs.
- Built a real hidden downstream attack where `npm test` starts child processes, reads a synthetic protected credential, and attempts an HTTP POST to a controlled receiver.
- Added the same-command ZeroCommit OFF/ON harness: OFF delivers the credential once; ON records and blocks the attempt, aborts, and proves the real workspace and credential are unchanged.
- Added structured process, child-process, protected-read, and network-attempt evidence plus a causal attack path.
- Added fail-closed handling for malformed or incomplete runtime evidence, process-argument redaction, accurate allowlist classification, a transform-stable CommonJS observer, bounded output, and process-tree timeout cleanup.
- Remediated the inherited production dependency advisories and made the production-only audit a permanent CI gate.
- Added a compiled `npm run demo:attack` path, scenario documentation, an explicit threat boundary, and clean-install CI evidence.
- Wired the scenario-scoped Node runtime observer into normal Agent transactions, transaction persistence, deterministic verification, host/container runner wiring, and the causal graph API model.
- Added database v3 migration for persisted runtime evidence and browser API types for the next run-visualization milestone.

Last verified:
- On Node.js 22 at implementation commit `977c0bf12f5d8992e4e5b10acf7aeaff553c1661`, a clean `npm ci` followed by `npm run check` passed server/web typechecking, 39 tests across 14 files, and both production builds.
- `npm audit --omit=dev --audit-level=high` reported `0` vulnerabilities.
- The compiled flagship demo produced: OFF receiver deliveries `1`; ON receiver deliveries `0`; ON decision `abort`; network contained `true`; real state unchanged `true`; protected credential unchanged `true`.
- Both modes recorded 4 process starts, 3 child-process spawn effects, 1 protected read, and 1 unauthorized network attempt; the ON attempt was blocked before delivery.
- Normal Agent transactions now persist runtime effects, summaries, deterministic violation decisions, and causal-graph evidence.

Blockers:
- A live Ark/Codex Agent Run still requires runtime credentials and the container environment.
- Runtime observation remains scenario-scoped to Node/global-`fetch`; it is not universal syscall mediation. The effect log is still a prototype evidence channel rather than a hardened out-of-process audit stream.

Next:
- Implement automatic abort → clean recovery → rerun → legitimate task commit.
- Then expose the persisted causal graph and Shadow/Real distinction in the run UI.
