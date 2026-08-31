# Security policy

ZeroCommit is a TikTok TechJam proof of concept built on the Volc Agent
Launchpad. Only the latest revision on the default branch is supported.

## Current security boundary

Every new Agent Run executes against a copied shadow workspace. The control
plane records filesystem effects, checks deterministic invariants, and owns the
only promotion path into the persistent Agent workspace.

The current boundary rejects:

- mutation of platform-managed `AGENTS.md`
- mutation of `.zerocommit/**` inside an Agent workspace
- permission-only mutations to protected paths
- absolute symlinks
- symlinks that resolve outside the shadow workspace
- hard-linked files
- special files such as sockets, devices, and FIFOs
- commit when the real or shadow workspace diverges after verification
- recovery journals that do not match a known transaction and Agent
- missing recovery artifacts when real state does not match stored integrity evidence
- subsequent Agent activity while transaction cleanup or recovery is unresolved

On abort, the shadow workspace is discarded. Unknown recovery artifacts are
discarded without trusting journal-supplied workspace paths. Known transactions
with no remaining artifacts are accepted as cleaned up only when the real-state
hash matches their recorded commit or baseline; any mismatch leaves the Agent
blocked for inspection. Before/shadow/final SHA-256 manifests provide
evidence of whether protected real state changed. Commit uses
crash-recoverable directory promotion rather than claiming a single-filesystem
operation can make arbitrary external effects atomic.

## Known limitations

- Filesystem effects are the only transactionally enforced effect class today.
- Outbound network traffic is not buffered or reversible; information already
  sent to a remote endpoint cannot be recalled.
- Process and network effects are not yet included in the authoritative effect
  ledger.
- The workspace root must remain under exclusive control of the Launchpad while
  a transaction is being verified and promoted.
- Workspace cloning and hashing currently scale with workspace size.
- Shared demo token; no user identity, authorization, RBAC, or tenant isolation.
- No CSRF protection.
- No per-Agent container boundary in ECS mode.
- Ordinary local containers, not hardened multi-tenant sandboxes.
- Broad outbound network access.
- Prompt-triggered command execution.
- Ark key available to the server and active Runtime container.
- Ark key stored in Terraform POC state.

## Report a vulnerability

Send the repository owner or event organizer the affected revision,
reproduction steps, impact, and suggested mitigation. Do not publish
credentials, personal data, or exploit details in an issue.

## Safe use

- Use the container Runtime for the hackathon judging path.
- Use a dedicated development machine or disposable ECS instance.
- Use only synthetic secrets and protected assets in adversarial scenarios.
- Use a scoped, revocable Ark key and a unique `APP_AUTH_TOKEN`.
- Keep local use on loopback and restrict ECS Web and SSH CIDRs.
- Add HTTPS before sending the shared token over an untrusted network.
- Never mount production data or provide Volcengine account AK/SK to Agents.
- Stop the POC, destroy test resources, and revoke keys after the event.

Codex uses `workspace-write` when Landlock is available. On unsupported kernels,
startup warns and relies on the outer Docker or rootless Podman boundary. This
fallback is not tenant isolation.
