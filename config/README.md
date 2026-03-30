# Configuration

**Scope:** This file describes only the config folder (example vs runtime vs secrets). For full behavior see `docs/configuration.md` and `docs/secret-handling.md`.

The extension reads **`window.EXTENSIONS_LLM_CHAT_CONFIG`** from tracked defaults plus optional gitignored overrides, and **`window.EXTENSIONS_LLM_CHAT_SECRETS`** for the API key.

## Setup

1. **Secrets (required for Send):**  
   `cp config/secrets.local.example.js config/secrets.local.js`  
   Edit `secrets.local.js` and set `apiKey` to your Cloud.ru Bearer token (no `Bearer ` prefix).

2. **Optional overrides:**  
   `cp config/runtime-config.example.js config/runtime-config.js`  
   Adjust models/URLs there. **Do not** put the API key in `runtime-config.js`.

3. **`index.html`** loads in order: `example.config.js` → `runtime-config.js` → `secrets.local.js`.

Do not commit `secrets.local.js` or `runtime-config.js` if they contain secrets or personal prefs you do not want shared. Both are listed in `.gitignore`.

## Upgrading after pulling a newer extension

1. Compare **`config/example.config.js`** (tracked) with your **`runtime-config.example.js`** template — new keys appear there as comments.
2. Merge any new fields into your **`runtime-config.js`** (or rely on example defaults).
3. Ensure **`secrets.local.js`** still exists; API key is never copied from `example.config.js`.

## Config shape

- **example.config.js** — defaults: models, Ollama URLs, capture, empty `apiKey` (overridden by secrets).
- **runtime-config.js** — optional `Object.assign` onto the above (no `apiKey`).
- **secrets.local.js** — `window.EXTENSIONS_LLM_CHAT_SECRETS = { apiKey: '…' }`.

Fields are documented in `example.config.js` and **docs/configuration.md**.

**CEP Node:** Screen capture needs Node in the manifest and Screen Recording for After Effects. See **docs/north-star-vision-agent.md**.
