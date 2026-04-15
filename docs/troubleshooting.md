# Troubleshooting

Common issues with the AE Motion Agent panel.

---

## Panel won't open or is blank

- **CEP version**: Ensure AE version matches the manifest (`CSXS/manifest.xml`).
- **Script load order**: Config scripts must load before `main.js` (see `index.html`). If any script fails, panel may be blank — check CEP DevTools (Debug → Show Developer Tools).
- **CSInterface.js missing**: Download and place in `lib/` — see README installation instructions.

---

## "Set API key in config/secrets.local.js"

- **Cause**: No API key found.
- **Fix**: `cp config/secrets.local.example.js config/secrets.local.js`, paste your Cloud.ru Bearer token (no `Bearer ` prefix). See [secret-handling.md](secret-handling.md).

---

## Send does nothing

- **No API key**: Send is blocked when key is empty — status bar shows config message.
- **No session**: Create one with the New button.
- **In flight**: While a request is running, Send is disabled. Wait or click Stop.

---

## "Error contacting cloud model"

- **Network**: Check internet and firewall. Ensure API base URL is reachable.
- **HTTP errors**: 4xx/5xx — verify `baseUrl` and `apiKey` in config. See [configuration.md](configuration.md).
- **Malformed response**: API returned non-JSON or missing `choices`. Check API status.
- **Retry**: The panel retries automatically on 429/5xx (3 attempts, exponential backoff).

---

## Agent tool errors

- Read the **tool call card** in chat — it shows the tool name, args, and error message.
- **Expression errors**: If `apply_expression` returns `ok: false` with `expressionError`, the agent should auto-retry with a corrected expression.
- **Wrong layer index**: Agent may reference a deleted or wrong layer. Ask it to re-inspect with `get_detailed_comp_summary`.
- **Property path errors**: "Can't access" usually means wrong property path. Agent should check `get_layer_properties` first.

---

## Undo doesn't revert everything

- **Batch undo**: The Undo button sends N × Cmd+Z where N = number of mutating tool calls. If AE's undo history is shorter than expected (e.g., due to AE's own undo limit), not all actions may revert.
- **Read-only tools** (`get_detailed_comp_summary`, `get_host_context`, etc.) are not counted as mutating.

---

## Preset toolbar issues

- **Dropdown doesn't open**: Reload CEP panel, check for JS errors in DevTools.
- **No selected layers**: "Apply preset" requires at least one selected layer in the active composition.
- **Range errors**: Duration, delay, intensity/amplitude are validated by the host. Out-of-range values return `ok: false`.

---

## Streaming not working

- SSE streaming requires Cloud.ru provider. Ollama provider does not use streaming.
- If text doesn't appear incrementally, the `onTextChunk` callback may not be firing — check DevTools console.

---

## Export / Report fails

- **Export**: Uses Node.js `require('fs')` — requires CEP mixed-context mode (`--mixed-context` in manifest).
- **Report**: Requires working Cloud.ru API key (sends session logs to LLM for analysis). Check network and key.
- **File path**: Both save to `~/Desktop/`. Ensure Desktop directory exists and is writable.

---

## Screen capture issues

- **Permission**: macOS requires Screen Recording permission for After Effects. System Settings → Privacy & Security → Screen Recording → enable AE.
- **Comp area capture**: May need Automation permission for System Events.
- **Timeout**: Increase `captureTimeoutMs` in config for large displays.
- **Node unavailable**: Capture requires `--enable-nodejs` and `--mixed-context` in manifest.

---

## Ollama vision errors

- Ensure Ollama is running (`ollama serve`) with vision models pulled.
- **GPU OOM**: Reduce `ollamaVisionMaxEdgePx` in config (default 1024, try 768 or 512).
- **Timeout**: Increase `ollamaVisionTimeoutMs` for slow hardware.
- Vision modules are loaded but **not connected** to the agent loop — they work only via dedicated capture buttons.

---

## Sessions lost after reload

- Sessions are stored in `localStorage` key `ae-motion-agent-state`. Clearing browser data or changing the CEP origin loses them.
- Use **Export** button to back up sessions before clearing.

---

## Debug logging

In CEP DevTools console:
```js
console.log(JSON.stringify(JSON.parse(localStorage.getItem('ae-motion-agent-state')), null, 2))
```

This dumps the full session state for inspection.
