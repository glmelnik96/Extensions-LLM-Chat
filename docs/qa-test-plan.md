# QA Test Plan (AE Motion Agent)

Quick smoke-test checklist. For comprehensive integration tests (T1-T10) see **[../AGENTS.md](../AGENTS.md)** § Iteration history — `~/Desktop/Логи/T*.json` are the user's saved test runs.

---

## 1. Launch and config

1. Open panel in AE — no errors in status bar, status shows **Ready**.
2. Without API key: **Send** is disabled, status bar shows config message.
3. With API key in `secrets.local.js`: **Send** works.
4. **Capability handshake** runs at startup — no "Host script outdated" warning in status.

---

## 2. Sessions

5. Fresh start → empty chat with one session in `localStorage`.
6. Send a few messages → reload panel → history is restored.
7. **Clear** → confirm dialog → messages cleared.
8. **Export** → JSON session file appears on Desktop.

---

## 3. Agent and tools

9. Simple request ("Add wiggle(3,25) to selected layer") → 1-3 tool calls + final text. No CoT in visible response.
10. **Undo** — reverts all mutating actions from last request (N × Cmd+Z).
11. Tool error → error badge in card, panel remains responsive, agent retries with a fix.
12. **Stop** — cancels mid-execution.

---

## 4. Shape content

13. "Create a red circle" → shape layer with ellipse + fill (1 `create_layer(shape)` + 1 `add_shape_ellipse` with explicit `layer_id`).
14. "Create a rounded rectangle" → `add_shape_rectangle` with roundness.
15. Provoke `add_shape_ellipse({})` style mistake — should be **blocked** by `_validateRequiredArgs` with hint about `layer_id`.

---

## 5. 3D / Camera / Light

16. "Enable 3D on selected layer" → `set_layer_3d(true)`.
17. "Create a camera with zoom 1733" → camera layer with right zoom.

---

## 6. Masks

18. "Add a mask with feather 30" → `add_mask(feather:30)`.
19. "Show me the masks on this layer" → `get_mask_info` returns data.
20. "Add a subtract-mode mask" → result includes `actualMode: "subtract"` (no warnings).
21. "Convert this text into masks" (on a text layer) → `create_masks_from_text` succeeds.

---

## 7. Markers

22. "Add a marker at t=2 with comment X" → marker created.
23. "List all markers" → `get_markers` returns array.

---

## 8. Import

24. "List project items" → `list_project_items` returns array.
25. "Import this file: /Users/.../foo.png" → file appears in Project panel.

---

## 9. Preview (Fix J behaviour)

26. "Capture the current frame" → `capture_comp_frame` called once, returns persistent path `~/AE-agent-captures/<date>/...`, inline image displays in chat.
27. **DO NOT** ask explicitly for capture in a multi-step request → model should NOT call `capture_comp_frame` and NOT emit any `![preview](file:///...)`. Fix J working.
28. Multi-time request ("frames at t=0, 0.5, 1.0") → model should honestly say "no time parameter — captures current playhead only". NO fabricated paths.

---

## 10. Streaming and UX

29. Send a long request → assistant text appears incrementally during generation.
30. Quick action button (Wiggle) → prompt sent.
31. Textarea grows as you type, capped around 8 lines.

---

## 11. Export / Report

32. **Export** → JSON file on Desktop with full session.
33. **Errors** → JSON with only failed tool calls.
34. **Report** → markdown file on Desktop with LLM-analyzed summary + tool latency stats table (per-tool count/errors/avg/min/max ms).

---

## 12. Expressions

35. Apply expression with `if (cond) a else b` syntax → `validationWarnings` field in result; agent rewrites as ternary.
36. Apply expression with `seedRandom(index, true)` → warning about frozen seed; agent uses `Math.floor(time*N)` instead.
37. `get_expression` returns current expression text.

---

## 13. Anti-spam guard (Fix B)

38. Provoke a failing call (e.g. `reorder_layer` inside a precomp) → after 3 failures with same args, 4th attempt blocked with `error_code: 'RETRY_BLOCKED'`. Agent sees the message and stops or asks the user.
39. Successful call between failures resets the streak for that key.

---

## 14. Idempotency (Fix #6)

40. Send `create_layer` with `client_op_id: "test-001"` twice in a row → second result has `deduplicated: true`, only 1 layer created in AE.
41. **Clear** button → idempotency cache also clears (next call with same `client_op_id` creates fresh).

---

## 15. Capability handshake (Fix #10)

42. Reload panel → DevTools console shows `[host] capabilities OK — version 2026-04-30-chat-cleanup` (or similar).
43. If a helper is renamed/removed in `host/index.jsx` without updating the probe list → status bar shows "Host script outdated: missing X" warning.
