# Agent reliability plan — close the loop (2026-09-02)

## Why

Six bug-hunt rounds produced ~45 prompt rules and a dozen host guards, yet the agent
still fails on simple human motion requests. Analysis of the code (not of single
findings) shows the failures share three structural causes:

1. **Open loop.** The agent never observes what it did: tool results are the only
   feedback, the vision check sees one still frame (documented as a weak signal).
   Semantically wrong but syntactically valid results pass (moon detached from its
   orbit, stagger doubled, rig built on a hidden layer).
2. **Poor world model.** `get_detailed_comp_summary` returned names/types/in-out/
   effects/expression snippets — no transform values, no keyframe ranges, no
   `enabled`/`locked`. The prompt told the model to "check `enabled` in the comp
   summary" — a field no read tool exposed. For "чуть правее / поменьше / ускорь"
   the model had to guess or spend turns it tends to skip.
3. **No plan, no acceptance check.** Thinking is off on every turn (GLM-5.1 timing
   justification; GLM-5.1 is no longer available anyway), `tool_choice: auto` lets
   the model start mutating immediately, and the final answer is accepted on the
   model's word. The worst findings (inverted name→range mapping, ignored "не трогай
   оригиналы", doubled stagger) are reading/planning errors, not API errors.

Model-independent harness fixes come first; model tuning is measured afterwards
with the eval corpus.

## Work packages

| # | Package | Kills | Files |
|---|---------|-------|-------|
| WP1 | **Scene snapshot**: `get_detailed_comp_summary` (full) adds per layer `enabled`, `locked`, `solo`, `shy`, `transform` values at comp time, `compPosition` for parented layers, `animated` {numKeys, from, to} per animated property, `text` for text layers, `timeRemapEnabled`, `numMasks`; root `time`, `bgColor`, `compId`. Compact mode adds `enabled`/`locked`. `fingerprint:true` (panel-only) adds hashes for diffing. | hidden/locked targets, parent-space guesses, "already satisfied" re-application, value guessing | host/index.jsx, toolRegistry.js, prompt |
| WP2 | **`probe_motion`** read tool: sample a property at N times (expressions applied), optional comp-space for Position, per-sample `visible`, summary {changes, maxDelta, first/last}. Ported from hunt-round6 `toCompSpace`. | unverifiable motion claims; orbit/stagger/speed checks become numbers | host, hostBridge, registry, READ_ONLY_TOOLS, prompt |
| WP3 | **Scene diff** (`lib/pure/sceneDiff.js`): before/after fingerprint snapshots → human-readable change list (added/removed/renamed, switches, parent, values, key ranges, expressions, effects, text). Shown as a transcript note after every mutating run. | phantom-done with tool calls that changed nothing; honest reporting from ground truth | lib/pure, main.js |
| WP4 | **Plan turn + verify turn** in the loop (config `agentPlanTurn`, `agentVerifyTurn`, default on): turn 0 without tools writes targets / hard constraints / expected observable result / steps; before accepting a final answer after ≥1 mutating call, ONE `[SYSTEM] VERIFY` message carries the actual scene diff and demands measurement (`probe_motion`/`get_keyframes`) and fixes. | planning errors, constraint violations, unverified claims | agentToolLoop.js, main.js, config |
| WP5 | **Prompt alignment**: rules that are now true (switches/values in summary), verify flow, tool count; remove contradictions. | rule/tool mismatch | agentSystemPrompt.js |
| WP6 | Tests: ES3 lint, sceneDiff, loop plan/verify, registry. | regressions | test/ |
| WP7 | Live CDP verification + regression run of hunt-round6 sessions. | — | scripts/ |

Deferred (measure first): prompt diet (−50% fixed tokens), deterministic motion
recipes (pop-in, slide-in, orbit, follow-delay, cam-shake), planner/executor model
split, `reasoning_effort` on the plan turn for gpt-oss.

## Design notes

- Snapshots are taken with `fingerprint:true`; hashes (`sig`) are short djb2/base36
  strings and never reach the model-facing summary.
- Comp switching mid-run: snapshot root carries `compId`; when ids differ the diff
  reports the switch and skips the per-layer comparison.
- Plan turn omits `tools` entirely (no `tool_choice: none` dependency on the server);
  the plan text is prepended to the final answer so the user sees plan + outcome.
- Verify turn fires at most once per run; the done-guard (zero tools / unresolved
  failures) keeps its own single nudge. Worst case +2 model turns per run — the
  user's stated priority is quality over cost/latency.
- Correction loop (vision) runs with plan/verify off.
