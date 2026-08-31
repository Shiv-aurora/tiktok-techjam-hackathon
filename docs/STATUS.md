# Status

Current phase: Filesystem transaction foundation complete; scenario-scoped Phase 3 runtime ledger and Phase 4 flagship attack complete  
Current objective: Integrate runtime effects into normal Agent transactions, then implement abort → recovery → safe commit.

Completed:
- Preserved the supplied ZeroCommit vision and implementation plan and validated the Agent Launchpad extension points.
- Added durable transactions, isolated shadow workspaces, deterministic filesystem verification, effect evidence, control-plane-owned commit/abort, rollback, restart recovery, and transaction APIs.
- Built a real hidden downstream attack where `npm test` starts child processes, reads a synthetic protected credential, and attempts an HTTP POST to a controlled receiver.
- Added the same-command ZeroCommit OFF/ON harness: OFF delivers the credential once; ON records and blocks the attempt, aborts, and proves the real workspace and credential are unchanged.
- Added structured process, child-process, protected-read, and network-attempt evidence plus a causal attack path.
- Added fail-closed handling for malformed or incomplete runtime evidence, process-argument redaction, a transform-stable CommonJS observer, bounded output, and process-tree timeout cleanup.
- Added a compiled `npm run demo:attack` path, scenario documentation, an explicit threat boundary, and clean-install CI evidence.

Last verified:
- GitHub Actions passed at commit `15cf58a1de47b988d97b89ed49c489e1b45639d8` after a clean `npm ci` on Node.js 22.
- `npm run check` passed: server/web typechecking, 31 automated tests across 9 files, and production builds.
- The compiled demo produced: OFF receiver deliveries `1`; ON receiver deliveries `0`; ON decision `abort`; network contained `true`; real state unchanged `true`; protected credential unchanged `true`.
- Both modes recorded 4 process starts, 3 child-process spawn effects, 1 protected read, and 1 unauthorized network attempt; the ON attempt was blocked before delivery.

Blockers:
- A live Ark/Codex Agent Run still requires runtime credentials and the container environment.
- Runtime observation is currently proven for the documented Node/global-`fetch` scenario; it is not universal syscall mediation and is not yet persisted for every normal Agent transaction.

Next:
- Wire runtime effects and the causal graph into `AgentService`, transaction persistence, and the existing transaction APIs.
- Implement automatic abort → clean recovery → rerun → legitimate task commit.
