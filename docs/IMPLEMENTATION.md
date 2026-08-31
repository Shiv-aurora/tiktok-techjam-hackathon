# ZeroCommit — Implementation Plan

## Objective

Transform the supplied TikTok Agent Launchpad into a working demonstration of **transactional agent execution**.

The implementation should preserve the existing platform where useful and focus engineering effort on ZeroCommit's unique contribution.

The implementation agent has discretion over architecture, libraries, internal abstractions, and sequencing within each phase.

Each phase below defines the desired outcome rather than prescribing how it must be implemented.

---

# Phase 0 — Understand and Validate the Starter

Establish a reliable baseline before changing behavior.

### Outcomes

- Understand the existing Agent Launchpad architecture.
- Identify the agent execution path and relevant runtime boundaries.
- Run the starter successfully.
- Execute at least one normal agent task end-to-end.
- Run the existing validation/test suite.
- Understand how agent workspaces, sessions, containers, and persistent state behave.
- Identify the correct extension points for ZeroCommit.
- Document important limitations or assumptions discovered in the starter.

### Completion condition

A normal starter agent can reliably perform a task and the implementation team understands where ZeroCommit belongs.

---

# Phase 1 — Establish the ZeroCommit Execution Model

Introduce the concept of a transaction into agent execution.

### Outcomes

- Every protected agent run can be associated with a transaction.
- Transactions have explicit lifecycle state.
- Effects from an active transaction are distinguishable from accepted persistent state.
- The system can clearly represent successful commit and abort outcomes.
- ZeroCommit operates in the backend/runtime execution path rather than existing only in the UI.
- The agent should not control its own commit authority.

### Completion condition

A simple agent task can execute through ZeroCommit and produce a transaction that either commits or aborts.

---

# Phase 2 — Create the Shadow/Real State Separation

Make the central ZeroCommit guarantee real.

### Outcomes

- Agent execution occurs against a meaningful speculative or isolated state.
- At least one meaningful class of persistent mutation does not immediately affect protected real state.
- Safe speculative changes can become persistent after verification.
- Unsafe speculative changes can be discarded.
- The system can prove whether protected state changed.
- Commit and abort semantics are observable and testable.

### Completion condition

The same task can demonstrate:

```text
safe transaction → commit → real state changes

unsafe transaction → abort → protected real state unchanged
```

---

# Phase 3 — Build the Effect Ledger

Create an authoritative representation of what occurred during a transaction.

### Outcomes

Capture the important effects required to understand and verify agent behavior.

At minimum, the implementation should meaningfully cover the effect classes necessary for the selected attack scenario.

Potential effect categories include:

- filesystem activity
- process execution
- child processes
- tool activity
- network attempts
- sensitive-resource access
- persistent-state changes

Each recorded effect should carry enough context to support verification and explanation.

The ledger should be usable by:

- security decisions
- tests
- the UI
- benchmark generation
- transaction evidence

### Completion condition

A transaction produces a structured effect history that explains what actually happened beyond the agent's top-level tool call.

---

# Phase 4 — Implement the First Real Adversarial Scenario

Create the canonical ZeroCommit demo attack.

### Recommended scenario

A legitimate coding task causes an apparently normal command to trigger hidden dangerous downstream behavior.

Example shape:

```text
User asks agent to fix code and run tests
        ↓
Agent executes legitimate command
        ↓
Repository/dependency/script triggers hidden behavior
        ↓
Protected resource accessed
        ↓
Unauthorized external effect attempted
```

### Outcomes

- The attack is real rather than UI simulation.
- Without meaningful ZeroCommit protection, the dangerous behavior is demonstrably possible.
- With ZeroCommit enabled, protected real state remains safe.
- The transaction records the relevant malicious effect chain.
- The transaction aborts cleanly.
- Evidence proves containment.

### Completion condition

There is a repeatable:

```text
ZeroCommit OFF → dangerous outcome possible

ZeroCommit ON → same scenario contained
```

demonstration.

---

# Phase 5 — Transaction Verification

Turn observed effects into a meaningful commit decision.

### Outcomes

- Transactions are evaluated before consequential speculative effects become accepted.
- Security invariants are explicit and testable.
- Verification uses observable effects rather than only trusting model-generated descriptions.
- Unsafe transactions reliably abort.
- Safe transactions reliably commit.
- Decisions include understandable reasons.
- Verification behavior is deterministic where appropriate.
- The system avoids becoming simply an LLM-based "is this safe?" classifier.

### Completion condition

Multiple safe and unsafe transactions are classified correctly enough to support automated testing and the hackathon demo.

---

# Phase 6 — Build the Causal Effect Graph

Make downstream consequences understandable.

### Outcomes

- Related actions/effects are connected when meaningful causal relationships can be established.
- The system can explain how an innocent-looking action led to dangerous behavior.
- The graph distinguishes high-level agent actions from downstream runtime effects.
- Suspicious paths are easy to identify.
- The graph representation is useful programmatically and visually.

Example desired explanation:

```text
User task
  ↓
Agent decision
  ↓
npm test
  ↓
package lifecycle script
  ↓
child process
  ↓
protected credential read
  ↓
unauthorized network attempt
```

### Completion condition

The primary adversarial demo produces a convincing causal chain rather than a flat event list.

---

# Phase 7 — Cleanup and Recovery

Move beyond a traditional kill switch.

### Outcomes

After an unsafe transaction:

- contaminated speculative state is discarded or isolated
- protected state remains trustworthy
- ZeroCommit identifies or returns to an appropriate safe state
- the failure is recorded clearly
- a new clean execution can begin

Then advance toward automatic recovery:

- avoid the previously dangerous path where practical
- preserve useful work when safe to do so
- allow the legitimate user task to continue
- produce a final safe transaction that commits

### Completion condition

The flagship demo achieves:

```text
unsafe execution
→ abort
→ zero protected damage
→ recover
→ resume
→ legitimate task succeeds
→ commit
```

---

# Phase 8 — Build the ZeroCommit Run Experience

Expose the new execution model clearly in the existing interface.

### Outcomes

A user should quickly understand:

- what task is running
- transaction status
- what the agent attempted
- what effects occurred
- what exists only in shadow state
- what has reached real state
- why a transaction was committed or aborted
- whether recovery is occurring
- whether the final task succeeded

Prioritize the visual distinction between:

```text
SHADOW WORLD

and

REAL WORLD
```

The main adversarial path should be visually compelling without requiring the user to inspect raw logs.

### Completion condition

A viewer unfamiliar with the code can understand the ZeroCommit concept from the interface within seconds.

---

# Phase 9 — Expand the Adversarial Test Suite

Demonstrate that ZeroCommit is a system rather than one scripted attack.

### Outcomes

Create several reproducible security scenarios spanning multiple attack classes.

Candidates include:

- protected credential access
- attempted credential exfiltration
- malicious dependency/lifecycle script
- destructive filesystem operation
- hidden child process
- dangerous shell chain
- unauthorized network destination
- indirect prompt injection from repository content
- symlink/path manipulation
- modification of security/transaction infrastructure
- benign actions resembling dangerous actions

Include both malicious and benign cases.

### Completion condition

Automated tests exercise ZeroCommit across a meaningful collection of attacks and normal tasks.

---

# Phase 10 — Evaluation and Benchmarking

Produce quantitative evidence.

### Outcomes

Create a reproducible evaluation harness comparing appropriate baselines.

Measure useful metrics such as:

- adversarial scenarios contained
- protected-state corruption incidents
- unauthorized external effects
- benign task success
- false-positive blocks
- recovery success
- task completion after attack
- execution overhead
- transaction latency

Evaluate:

```text
baseline / ZeroCommit disabled

vs

ZeroCommit enabled
```

Do not manufacture results.

Clearly document test setup and limitations.

### Completion condition

The README/demo can show real measured evidence that ZeroCommit improves safety while preserving useful agent behavior.

---

# Phase 11 — Harden Trust Boundaries

Ensure the architecture supports the product claims.

### Outcomes

Review whether:

- the agent can tamper with the transaction manager
- the agent can modify its own policy
- the agent can falsify the effect ledger
- the agent can bypass commit authority
- protected state can be reached through unintended paths
- unsafe external effects can escape prematurely
- secrets can appear in logs or UI
- failure paths accidentally commit speculative state

Strengthen the design where required.

Clearly document what ZeroCommit protects and what remains outside its threat model.

### Completion condition

The implementation's security claims correspond to actual architecture boundaries.

---

# Phase 12 — Handle Irreversible Effects Honestly

Clarify where transactional execution works and where escrow/pre-authorization is required.

### Outcomes

Categorize effects into useful classes such as:

- safely speculative
- reversible
- bufferable
- escrowable
- requires pre-commit authorization
- inherently irreversible

Ensure the product does not imply arbitrary irreversible external actions can always be rolled back.

Where appropriate, demonstrate how ZeroCommit handles an external action without allowing premature commitment.

### Completion condition

The architecture and documentation accurately explain the limits of transactional agent execution.

---

# Phase 13 — Reliability and Failure Handling

Make the demo robust.

### Outcomes

Handle realistic failure conditions including:

- agent failure
- transaction timeout
- container/runtime crash
- failed verification
- failed commit
- failed cleanup
- partial speculative execution
- malformed effect records
- interrupted recovery
- repeated attacks

ZeroCommit should fail closed for protected consequential operations where appropriate.

### Completion condition

The flagship demo and tests remain reliable under expected failure conditions.

---

# Phase 14 — Architecture and Documentation

Make the technical contribution easy to evaluate.

### Outcomes

Produce:

- clear README
- selected Track #1 / Kill Switch identification
- setup instructions
- architecture diagram
- trust-boundary diagram
- ZeroCommit lifecycle explanation
- benchmark methodology
- threat model
- limitations
- demo scenario
- test instructions
- comparison with the unmodified starter
- explanation of what ZeroCommit itself adds

A reviewer should be able to distinguish:

```text
TikTok starter capabilities

from

ZeroCommit contributions
```

### Completion condition

A technical reviewer can understand, run, inspect, and evaluate the project without needing private explanation.

---

# Phase 15 — Final Hackathon Demo Path

Optimize everything around a single reliable three-minute story.

### Target narrative

### Opening

Autonomous agents can perform powerful actions, but security systems often approve actions before knowing their complete downstream consequences.

### Setup

Give the agent a legitimate coding task.

### Wow Moment 1 — Hidden Attack

The agent runs a normal command.

ZeroCommit reveals the hidden dangerous downstream causal chain.

### Wow Moment 2 — Two Worlds

Show:

```text
SHADOW WORLD:
dangerous effects occurred

REAL WORLD:
protected state unchanged
```

Transaction:

```text
ABORTED
```

Show concrete integrity evidence.

### Wow Moment 3 — Recovery

ZeroCommit returns to a trustworthy state.

The agent continues the legitimate task.

A safe transaction finishes.

```text
COMMITTED
```

### Evidence

Briefly show the adversarial benchmark and architecture.

### Completion condition

The demo is reproducible, understandable without narration-heavy explanation, and demonstrates all required Track 1 Kill Switch behaviors.

---

# Phase 16 — Final Quality Audit

Before submission, challenge the project aggressively.

### Verify

- the system is not UI theater
- attack behavior is real
- commit/abort behavior is real
- protected state genuinely remains unchanged
- recovery genuinely works
- tests are meaningful
- benchmark results are reproducible
- starter functionality still works
- no real credentials exist anywhere
- no secrets leak in logs/screenshots
- README commands work from a clean environment
- architecture claims match implementation
- demo does not depend on fragile manual timing
- project clearly surpasses a basic sandbox or kill switch

### Final standard

ZeroCommit should feel like a coherent new execution abstraction, not a collection of security features added to an agent dashboard.
