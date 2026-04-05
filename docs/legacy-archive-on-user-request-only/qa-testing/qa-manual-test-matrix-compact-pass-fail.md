# Manual test matrix

Compact matrix for QA. Tick when passed. See **docs/qa-test-plan.md** (short agent smoke) and **qa-legacy-full-test-plan-copilot-pipeline-ui.md** for full Copilot-era steps.

| # | Area | Test | Pass |
|---|------|------|-----:|
| 1 | Startup | Panel launches | ☐ |
| 2 | Startup | Missing config → clear status, no crash | ☐ |
| 3 | Startup | Valid config → Send enabled when session + input | ☐ |
| 4 | Session | New session created | ☐ |
| 5 | Session | Switch session | ☐ |
| 6 | Session | Rename session | ☐ |
| 7 | Session | Clear current session | ☐ |
| 8 | Session | Clear all sessions | ☐ |
| 9 | Session | Persistence after reload | ☐ |
| 10 | Target | Target refresh (@) | ☐ |
| 11 | Target | Layer selection | ☐ |
| 12 | Target | Property selection | ☐ |
| 13 | Target | No comp / no target → graceful | ☐ |
| 14 | Pipeline | Happy path → assistant message, Apply enabled | ☐ |
| 15 | Pipeline | Blocked → system message, Apply disabled | ☐ |
| 16 | Pipeline | Warned draft → warning prefix, Apply disabled | ☐ |
| 17 | Pipeline | Repair path → repair then finalize | ☐ |
| 18 | Failure | Missing config at Send → status, no request | ☐ |
| 19 | Failure | Network failure → user-facing error message | ☐ |
| 20 | Failure | Malformed response → fallback or error message | ☐ |
| 21 | Apply | Apply success | ☐ |
| 22 | Apply | Apply invalid target → host error message | ☐ |
| 23 | Apply | Apply unsupported property → host error | ☐ |
| 24 | Policy | No auto-apply | ☐ |
| 25 | Policy | Final-only chat output | ☐ |

---

**How to use**: Run scenarios from qa-test-plan.md; mark Pass when behavior matches "Expected". Use for release sign-off and regression checks.
