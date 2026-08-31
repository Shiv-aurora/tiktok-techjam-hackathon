# Security policy

ZeroCommit is a TikTok TechJam proof of concept built on the Volc Agent
Launchpad. Only the latest revision on the default branch is supported.

## Current security boundary

### Persistent filesystem state

Every new Agent Run executes against a copied shadow workspace. The control
plane records filesystem effects, checks deterministic invariants, and owns the
only promotion path into the persistent Agent workspace.

The filesystem boundary rejects:

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
blocked for inspection. Before/shadow/final SHA-256 manifests provide evidence
of whether protected real state changed. Commit uses crash-recoverable directory
promotion rather than claiming a single filesystem operation can make arbitrary
external effects atomic.

### Flagship Node/fetch scenario

The reproducible hidden-exfiltration harness injects a read-only Node preloader
through `NODE_OPTIONS`. For the selected fixture it records:

- Node process starts and child-process relationships
- reads of explicitly configured protected resources
- outbound calls made through Node's global `fetch`

The harness never records credential contents or request bodies. Protected-read
evidence contains only the resource path, byte count, and SHA-256 hash. Common
credential flags, token formats, URL credentials, query strings, and long
process arguments are redacted before process evidence is stored.

In enforcement mode, an origin outside the allowlist is rejected inside the
`fetch` wrapper before the request reaches the controlled receiver. The
transaction verifier then aborts because it observed a protected-resource read
and unauthorized network attempt. The existing shadow-workspace abort path
proves the persistent workspace and synthetic credential remained unchanged.

This is real enforcement for the documented fixture, but it is intentionally
not described as universal process or network mediation.

## Known limitations

- The general ZeroCommit transaction path currently provides persistent
  filesystem isolation and verification. Flagship runtime effects are not yet
  persisted on every normal Agent transaction.
- Process/network observation follows Node processes that inherit
  `NODE_OPTIONS`; native binaries and processes that discard that environment
  are not covered by the current observer.
- Network enforcement currently covers Node's global `fetch`. Raw sockets,
  `node:http`, third-party clients, native tools, DNS side channels, and other
  egress paths are outside this scenario boundary.
- The injected observer and JSONL evidence file are not yet protected by an
  OS-level telemetry boundary against a deliberately observer-aware hostile
  process. Missing or malformed evidence fails verification, but forged valid
  evidence remains a later hardening concern.
- Outbound effects not mediated before delivery are irreversible; information
  already sent to an uncontrolled endpoint cannot be recalled.
- The workspace root must remain under exclusive control of the Launchpad while
  a transaction is being verified and promoted.
- Workspace cloning and hashing currently scale with workspace size.
- Shared demo token; no user identity, authorization, RBAC, or tenant isolation.
- No CSRF protection.
- No per-Agent container boundary in ECS mode.
- Ordinary local containers, not hardened multi-tenant sandboxes.
- The general Agent Runtime still has broad outbound network access.
- Prompt-triggered command execution remains part of the product's threat model.
- Ark key is available to the server and active Runtime container.
- Ark key is stored in Terraform POC state.

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
