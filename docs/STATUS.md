# Status

Current phase: Filesystem transaction foundation complete; scenario-scoped Phase 3 runtime ledger and Phase 4 flagship attack complete  
Current objective: Validate runtime-effect integration for normal Agent transactions, then implement abort → recovery → safe commit.

Completed:
- Preserved the supplied ZeroCommit vision and implementation plan and validated the Agent Launchpad extension points.
- Added durable transactions, isolated shadow workspaces, deterministic filesystem verification, effect evidence, control-plane-owned commit/abort, rollback, restart recovery, and transaction APIs.
- Built a real hidden downstream attack where `npm test` starts child processes, reads a synthetic protected credential, and attempts an HTTP POST to a controlled receiver.
- Added the same-command ZeroCommit OFF/ON harness: OFF delivers the credential once; ON records and blocks the attempt, aborts, and proves the real workspace and credential are unchanged.
- Added structured process, child-process, protected-read, and network-attempt evidence plus a causal attack path.
- Added fail-closed handling for malformed or incomplete runtime evidence, process-argument redaction, accurate allowlist classification, a transform-stable CommonJS observer, bounded output, and process-tree timeout cleanup.
- Remediated the inherited production dependency advisories and made the production-only audit a permanent CI gate.
- Added a compiled `npm run demo:attack` path, scenario documentation, an explicit threat boundary, and clean-install CI evidence.
- Wired the scenario-scoped Node runtime observer into normal Agent transactions, transaction persistence, deterministic verification, and the causal graph API model.

Last verified:
- A clean Node.js 22 remediation run at commit `3837a7a4310b00c19f2339166611ed6147084dce` reported `0` npm vulnerabilities, passed server/web typechecking, passed 32 tests across 10 files, and completed both production builds.
- The compiled demo produced: OFF receiver deliveries `1`; ON receiver deliveries `0`; ON decision `abort`; network contained `true`; real state unchanged `true`; protected credential unchanged `true`.
- Both modes recorded 4 process starts, 3 child-process spawn effects, 1 protected read, and 1 unauthorized network attempt; the ON attempt was blocked before delivery.
- The temporary write-enabled remediation workflow was removed after generating and validating the lockfile update.

Blockers:
- A live Ark/Codex Agent Run still requires runtime credentials and the container environment.
- Runtime observation remains scenario-scoped to Node/global-`fetch`; it is not universal syscall mediation. The effect log is still a prototype evidence channel rather than a hardened out-of-process audit stream.

Next:
- Implement automatic abort → clean recovery → rerun → legitimate task commit.
- Then expose the persisted causal graph and Shadow/Real distinction in the run UI.
