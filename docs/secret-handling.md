# Secret handling

## Policy

- **No API keys in tracked files.** The repository ships `config/example.config.js` with `apiKey: ''` and `config/secrets.local.example.js` as a template only.
- **Secrets on disk:** Put your Cloud.ru Bearer token in **`config/secrets.local.js`**, which is **gitignored** (see `.gitignore`). That file is loaded after `example.config.js` and optional `runtime-config.js`.
- **Optional overrides without secrets:** Use **`config/runtime-config.js`** (gitignored) merged onto the example config — copy from `runtime-config.example.js`. Do not put `apiKey` there; use `secrets.local.js`.
- **Clear failure when missing.** If no key is available from secrets or config, Send is blocked and the panel shows a short message. Diagnostics must not log the key.

## Load order (`index.html`)

1. `config/example.config.js` — defaults (tracked).
2. `config/runtime-config.js` — optional overrides, no secrets (gitignored; copy from `runtime-config.example.js` if needed).
3. `config/secrets.local.js` — `window.EXTENSIONS_LLM_CHAT_SECRETS.apiKey` (gitignored; copy from `secrets.local.example.js`).

`main.js` **`getConfig()`** uses `EXTENSIONS_LLM_CHAT_SECRETS.apiKey` when non-empty; otherwise falls back to `EXTENSIONS_LLM_CHAT_CONFIG.apiKey` (for legacy setups only).

## First-time setup

```bash
cp config/secrets.local.example.js config/secrets.local.js
# Edit secrets.local.js — paste your Bearer token (no "Bearer " prefix).
cp config/runtime-config.example.js config/runtime-config.js   # optional
```

If `secrets.local.js` is missing, the browser will fail to load that script (404) and the panel may not run until you create the file.

## What not to do

- Do not commit `config/secrets.local.js` or any file containing a real key.
- Do not log or display the API key in the UI or in diagnostics.
- Do not hardcode keys in `main.js` or other tracked files.

## Security model (local extension)

| Risk | Mitigation |
|------|------------|
| Accidental `git commit` of secrets | `.gitignore` lists `secrets.local.js` and `runtime-config.js`. |
| Key in Time Machine / cloud-synced folder | The whole user folder may sync; treat disk like sensitive data. |
| Key ever committed or pasted in chat | **Rotate** the token at the provider. |
| Malware on the machine | Any local file is readable; OS account hygiene matters. |

This layout does **not** encrypt secrets at rest; it **separates** them from the copy-paste path developers use for the rest of the repo.

## Cloud API (Foundation Models)

- The panel calls your configured **`baseUrl`** (default Cloud.ru Foundation Models) **`/chat/completions`** with **`Authorization: Bearer <apiKey>`**.
- Only **`getConfig().apiKey`** (merged from `secrets.local.js`) is sent in that header. The key is **not** written to the chat transcript, diagnostics samples, or user-visible error strings by design.
- Rotating the key at the provider invalidates old tokens immediately; update **`config/secrets.local.js`** and reload the panel.

## Safe pattern in code

1. Read the key only via `getConfig().apiKey` after the merge from secrets.
2. Send it only as the `Authorization: Bearer …` header (or equivalent). Never append to error strings or transcripts.
