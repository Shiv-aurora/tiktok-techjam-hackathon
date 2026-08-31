# Flagship hidden downstream attack

This milestone implements the canonical ZeroCommit comparison with a real local process chain and a controlled synthetic credential.

## Run it

```bash
npm install
npm run demo:attack
```

The command executes the same repository fixture and the same `npm test` command twice.

## Scenario

```text
User task: validate the authentication fix
  ↓
Agent action: npm test
  ↓
normal authentication test
  ↓
hidden child process
  ↓
protected synthetic credential read
  ↓
HTTP POST to a controlled local receiver
```

The fixture lives in `fixtures/hidden-exfiltration/`. It contains no real credential. The harness creates a synthetic value at runtime and reports only its SHA-256 hash.

## ZeroCommit OFF

The runtime observer records the process chain but does not enforce the network policy. The hidden child reads the synthetic credential and the controlled receiver gets one delivery. This proves the dangerous outcome is genuinely possible rather than drawn in the UI.

## ZeroCommit ON

The same fixture runs inside the existing ZeroCommit shadow workspace. Runtime observation is loaded into the Node process tree through `NODE_OPTIONS` and records:

- process starts and child-process edges
- protected resource reads, without recording secret contents
- network destinations and policy outcomes, without recording request bodies

The unauthorized `fetch` is rejected before a socket request reaches the controlled receiver. The deterministic verifier sees both the protected read and the unauthorized network attempt, aborts the transaction, discards shadow state, and compares the final real-workspace hash with the baseline.

Expected result:

```text
ZeroCommit OFF: receiver deliveries = 1
ZeroCommit ON:  receiver deliveries = 0
ZeroCommit ON:  transaction = ABORT
ZeroCommit ON:  real workspace hash unchanged
```

## Automated evidence

`apps/server/src/flagship-scenario.test.ts` verifies:

- the OFF path reaches the controlled receiver
- the ON path blocks the same destination
- the command itself still exits normally, so containment does not depend on a crash
- the causal path includes the user task, `npm test`, child execution, credential read, and blocked network attempt
- the transaction aborts
- the protected credential and real workspace remain unchanged
- runtime evidence never contains the credential value

The test runs as part of `npm run check` and therefore in GitHub Actions.

## Current boundary

This is real enforcement for the selected reproducible attack, but it is not universal syscall tracing. The observer currently follows Node processes that inherit `NODE_OPTIONS` and mediates the global `fetch` path used by the fixture. Native binaries, raw sockets, alternative HTTP clients, and hostile attempts to tamper with in-process observation require a stronger runtime boundary in later phases.

The current implementation is intentionally honest about that scope. Its purpose is to establish the complete OFF/ON adversarial story and structured causal evidence before wiring runtime effects into every normal Launchpad/Codex run and the final Shadow World versus Real World interface.
