# Runtime State Schema

Format of panel state and session data in the AE Motion Agent.

---

## Global `state` (in memory)

`main.js` maintains a state object:

| Field | Persisted | Description |
|-------|-----------|-------------|
| `sessions` | yes | Array of session objects |
| `activeSessionId` | yes | ID of the active session |
| `nextSessionIndex` | yes | Counter for new session titles |
| `isRequestInFlight` | no | Whether an agent request is running |
| `currentAbortHandle` | no | Abort handle for cancellation |
| `lastMutatingToolCount` | no | Count of mutating tools in last request (for undo) |
| `lastModelStatus` | no | Last model status for status bar |
| `selectedPresetKey` | no | Currently selected preset in toolbar |
| `isPresetInFlight` | no | Whether a preset is being applied |

---

## localStorage

Key: `ae-motion-agent-state`

```json
{
  "sessions": [...],
  "activeSessionId": "session_...",
  "nextSessionIndex": 2
}
```

---

## Session format

Each element in `sessions[]`:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID (e.g. `session_1713012345678_abc123`) |
| `title` | string | Display name ("Chat 1", etc.) |
| `createdAt` | number | `Date.now()` at creation |
| `updatedAt` | number | Updated on message changes |
| `model` | string | Model ID (e.g. `cloudru/Qwen/Qwen3-Coder-Next`) |
| `messages` | array | Conversation history |

---

## Message formats

### User message
```json
{ "role": "user", "content": "Create a red circle and animate it" }
```

### Assistant message (for API)
```json
{
  "role": "assistant",
  "content": "Here's what I created...",
  "tool_calls": [
    {
      "id": "call_123",
      "type": "function",
      "function": { "name": "create_layer", "arguments": "{\"type\":\"shape\"}" }
    }
  ]
}
```

### Tool result message (for API)
```json
{
  "role": "tool",
  "tool_call_id": "call_123",
  "content": "{\"ok\":true,\"layerIndex\":1}"
}
```

### UI display
In the rendered chat, assistant messages show:
- Text content (markdown rendered)
- Tool call cards (collapsible) with: tool name, status badge (ok/error/running), args, result

---

## Export format

The **Export** button saves:
```json
{
  "exportedAt": "2026-04-13T12:00:00.000Z",
  "sessions": [...]
}
```

The **Report** button saves two files:
- `.md` — LLM-analyzed bug report
- `.json` — raw session dump (same format as Export)
