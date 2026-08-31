# ZeroCommit — Vision

## One-Line Idea

**ZeroCommit gives autonomous AI agents speculative authority instead of immediate real-world authority: agents can act freely in an isolated shadow environment, but consequential effects only become real after the complete action chain has been observed and verified.**

## The Problem

Autonomous agents increasingly have permission to:

- execute shell commands
- modify source code
- install dependencies
- access credentials
- call APIs
- communicate over networks
- interact with tools through MCP
- spawn child processes
- modify persistent state

Most current agent-security systems make decisions before or during individual actions:

- classify prompts
- approve or reject tool calls
- enforce MCP policies
- sandbox processes
- detect suspicious commands
- apply filesystem/network restrictions
- terminate an agent when something looks dangerous

These approaches are useful, but they share a fundamental weakness:

**the security system often has to decide whether an action is safe before seeing its full consequences.**

A benign-looking action can trigger dangerous downstream effects.

Example:

```text
User: Fix the authentication bug and run the tests.

Agent:
npm test
```

`npm test` itself is legitimate.

But somewhere downstream:

```text
npm test
  ↓
package script
  ↓
child process
  ↓
credential read
  ↓
network connection
  ↓
credential exfiltration
```

A policy operating only at the prompt or tool-call boundary may never understand the complete effect chain.

## ZeroCommit's Core Insight

Treat autonomous agent execution like a transaction.

The agent should be able to execute normally and discover what it needs to do.

However:

> **Execution does not imply commitment.**

ZeroCommit separates:

```text
WHAT THE AGENT ATTEMPTS

from

WHAT THE REAL WORLD ACCEPTS
```

The agent operates against speculative state.

ZeroCommit observes the resulting effects.

Only verified effects are committed to persistent or external state.

Unsafe transactions are aborted.

Where possible, the system recovers from a clean state and allows the legitimate task to continue.

## Mental Model

Traditional agent execution:

```text
Agent
  ↓
Action
  ↓
Policy check
  ↓
REAL WORLD
```

ZeroCommit:

```text
Agent
  ↓
SPECULATIVE EXECUTION
  ↓
Observe complete effects
  ↓
Build effect + causal record
  ↓
Verify transaction
  ↓
 ┌───────────────┐
 │               │
SAFE           UNSAFE
 │               │
COMMIT          ABORT
                 │
              RECOVER
                 │
               RESUME
```

## Product Experience

ZeroCommit should feel less like a cybersecurity dashboard and more like a new execution primitive for autonomous agents.

A user launches an agent task normally.

For every run, ZeroCommit should make it obvious that there are two states:

### Shadow World

What the agent attempted to do.

Examples:

- files created
- files modified
- files deleted
- processes started
- network destinations contacted
- sensitive resources accessed
- tools invoked
- downstream actions triggered

### Real World

What ZeroCommit actually allowed to persist.

The key visual moment is when those worlds diverge.

Example:

```text
SHADOW WORLD

23 filesystem mutations
4 child processes
1 protected credential read
1 unauthorized network request


REAL WORLD

0 unsafe mutations
0 protected credentials exposed
0 unauthorized network requests committed
```

Then:

```text
TRANSACTION ABORTED
REAL STATE UNCHANGED
```

## The Three Core Demo Moments

### 1. Reveal the Hidden Consequence

The agent performs an apparently legitimate task.

A downstream dependency, script, tool, or process performs a dangerous action.

ZeroCommit reveals the complete effect chain.

Example:

```text
npm test
  ↓
postinstall
  ↓
node child process
  ↓
protected secret
  ↓
unknown network destination
```

The important point is that the original agent action itself did not obviously look malicious.

### 2. Prove Zero Damage

ZeroCommit aborts the transaction.

The system should provide concrete evidence that protected real-world state did not change.

Examples:

- matching before/after hashes
- no protected filesystem mutation
- no committed unauthorized network request
- unchanged secret
- clean persistent workspace
- terminated speculative runtime

The product should prove containment rather than simply displaying "Blocked."

### 3. Recover and Finish the Task

Stopping an agent is not enough.

ZeroCommit should attempt to return to the latest trustworthy state, remove or constrain the offending execution path, and allow the useful task to continue.

The ideal final sequence is:

```text
ATTACK
  ↓
ZERO REAL-WORLD DAMAGE
  ↓
ABORT
  ↓
RECOVER
  ↓
RESUME
  ↓
LEGITIMATE TASK COMPLETED
  ↓
SAFE TRANSACTION COMMITTED
```

This is the central wow moment of the product.

## Core Product Concepts

### Transaction

A bounded unit of agent execution whose effects have not yet been accepted into real state.

A transaction should have clear lifecycle states such as:

```text
created
executing
verifying
committing
committed

or

created
executing
verifying
aborting
aborted
recovering
```

The exact internal implementation is flexible.

### Effect Ledger

ZeroCommit should maintain an authoritative record of meaningful effects generated during a transaction.

The goal is to answer:

> What actually happened because this agent run occurred?

The ledger should be useful for verification, debugging, visualization, testing, and post-run evidence.

### Causal Effect Graph

Where possible, ZeroCommit should connect effects together rather than presenting a flat log.

Example:

```text
User request
   ↓
Agent decision
   ↓
npm test
   ↓
child process
   ↓
credential read
   ↓
network attempt
```

The product should make hidden downstream behavior understandable within seconds.

### Commit Boundary

There must be a meaningful boundary between speculative agent behavior and persistent/external effects.

The agent itself must not own or control this boundary.

### Verification

Before consequential effects become real, ZeroCommit determines whether the transaction should be accepted.

Verification should be grounded in observable behavior and explicit security invariants rather than relying entirely on an LLM saying something "looks unsafe."

### Abort

An unsafe transaction must be prevented from contaminating protected persistent state.

The abort path should leave evidence that containment succeeded.

### Recovery

ZeroCommit should attempt to recover useful work rather than treating every violation as a terminal failure.

Recovery is a first-class part of the product.

## Security Philosophy

ZeroCommit should assume:

- the agent can make bad decisions
- the model can be manipulated
- repository content can be malicious
- dependencies can be malicious
- tools can behave unexpectedly
- child processes can perform hidden actions
- instructions can come from untrusted data
- the agent may not know it is compromised

Therefore the primary security boundary must exist **outside the agent's own reasoning process**.

The agent should not be able to disable or rewrite the mechanism responsible for observing, validating, committing, or aborting its actions.

## What ZeroCommit Is Not

ZeroCommit is not primarily:

- a prompt-injection classifier
- an MCP firewall
- an approval popup
- an LLM safety judge
- an RBAC dashboard
- a SIEM
- an observability product
- a generic agent sandbox
- a collection of unrelated security features

Those capabilities may support ZeroCommit, but none of them are the product.

The product is:

> **Transactional execution for autonomous agents.**

## Scope for TikTok TechJam

ZeroCommit is being built as an advanced implementation of:

**Track #1 — Agent Launchpad: Lightweight Agent Middleware**

with the selected middleware direction:

**Kill Switch / Safety & Sandboxing**

It should build directly on the supplied Agent Launchpad rather than replacing it.

The existing platform provides the agent lifecycle, browser experience, control plane, workspace, Codex runtime, and local container execution.

ZeroCommit should become a deep extension of the execution path.

## Required Competition Story

The final project must clearly demonstrate:

1. a real agent run
2. one explicit dangerous behavior
3. meaningful containment beyond the starter's existing resource limits
4. the protected asset remaining unchanged
5. cleanup or recovery
6. a subsequent safe task executing successfully
7. backend/runtime enforcement rather than UI-only simulation
8. automated evidence covering the core security behavior

## Benchmark Philosophy

ZeroCommit should not rely on a single hand-scripted attack.

The project should include a reproducible adversarial evaluation suite.

Useful attack classes include:

- secret exfiltration
- malicious package lifecycle scripts
- destructive filesystem mutation
- dangerous shell chaining
- unexpected child processes
- unauthorized network destinations
- poisoned repository instructions
- indirect prompt injection
- symlink/path manipulation
- attempts to modify ZeroCommit itself

The benchmark should compare behavior with and without ZeroCommit.

Metrics should focus on questions such as:

- How many attacks caused real protected-state damage?
- How many malicious effects were contained?
- How many benign tasks still succeeded?
- How often could attacked tasks recover and finish?
- What runtime overhead does ZeroCommit introduce?
- How many false blocks occur?

Real measured results matter more than impressive-looking numbers.

## Trust and Honesty

The system should not claim impossible guarantees.

Some external effects are irreversible.

For example:

- an email that has already been delivered
- money that has already been transferred
- information already sent to an uncontrolled endpoint

ZeroCommit should distinguish between:

- effects that can safely remain speculative
- effects that can be buffered or escrowed
- effects that can be rolled back
- effects that require pre-commit authorization
- effects that cannot realistically be reversed

The product becomes stronger by making these boundaries explicit.

## Desired Architecture Properties

The final architecture should aim for:

- clear trust boundaries
- strong separation between agent and commit authority
- deterministic behavior where security invariants permit it
- auditable transaction history
- reproducible attack scenarios
- modularity across different effect types
- low coupling to one specific model
- graceful failure
- understandable execution traces
- practical local deployment
- a credible path beyond a hackathon prototype

The implementation agent is free to choose the best technical design that satisfies these properties.

## User Interface Principles

The UI should optimize for understanding in seconds.

The main run experience should prioritize:

1. current transaction state
2. agent activity
3. effect graph
4. shadow-world changes
5. real-world changes
6. violation explanation
7. commit/abort result
8. recovery status

Avoid overwhelming dashboards.

The most important visual contrast is:

```text
WHAT THE AGENT DID

vs

WHAT THE REAL WORLD ACCEPTED
```

## Success Definition

ZeroCommit succeeds if a judge can watch the demo and understand within approximately ten seconds:

> "The agent gets to act, but its actions don't become real until ZeroCommit verifies the consequences."

And by the end of the demo understands:

> "Even when the agent is compromised through something that looked legitimate, the dangerous downstream effects never reach protected real state, and the agent can recover and finish the useful task."

## Long-Term Direction

The hackathon implementation focuses on coding agents, but the abstraction should be broader.

The same transactional model could eventually apply to agents operating:

- cloud infrastructure
- enterprise SaaS
- developer environments
- databases
- browsers
- finance systems
- internal tooling
- robotic systems
- procurement systems

The long-term question ZeroCommit explores is:

> **How do we give autonomous agents meaningful power without giving every intermediate model decision immediate irreversible authority?**
