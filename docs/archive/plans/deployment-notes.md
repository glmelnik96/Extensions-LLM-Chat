# Deployment notes

How to install and run the extension in a CEP environment (e.g. Adobe After Effects).

---

## Prerequisites

- Adobe After Effects (version compatible with CSXS/manifest.xml).
- CEP support enabled (see Adobe CEP documentation for your OS and AE version).

---

## Install location

- Extension folder (e.g. **Extensions LLM Chat**) is placed in the CEP extensions directory, for example:
  - macOS: `~/Library/Application Support/Adobe/CEP/extensions/Extensions LLM Chat`
  - Windows: `%APPDATA%\Adobe\CEP\extensions\Extensions LLM Chat`
- manifest **CSXS/manifest.xml** must list the correct host (After Effects) and version.

---

## Configuration

1. Copy **config/example.config.js** to **config/runtime-config.js** in the extension folder.
2. Edit **config/runtime-config.js** and set **apiKey** to your cloud API Bearer token. Adjust **baseUrl**, **defaultModel**, **fallbackModel** if needed.
3. In **index.html**, change the config script tag from `config/example.config.js` to `config/runtime-config.js` so the panel loads your key.
4. Do **not** commit **runtime-config.js** if it contains a real key (it is in .gitignore).

If you leave the default (example.config.js with empty apiKey), the panel will show "Set API key in config. See config/README.md" and Send will do nothing until a valid config is provided.

See **config/README.md**, [../../configuration.md](../../configuration.md), and [../../secret-handling.md](../../secret-handling.md).

---

## Loading the panel

- From After Effects: **Window → Extensions → [Extensions LLM Chat]** (or the name defined in the manifest).
- For debugging: use CEP **Debug → Show Developer Tools** to see console logs and run diagnostics (e.g. **EXTENSIONS_LLM_CHAT_DIAGNOSTICS.setDebug(true)**).

---

## Host script (Apply / target refresh)

- **host/index.jsx** is loaded by the panel via **CSInterface.evalScript** (or $.evalFile with the path to host/index.jsx). Ensure the path in main.js (or buildHostEvalScript) matches your install location so comp summary and Apply Expression work.
- If Apply or target refresh fails, check the host script path and ExtendScript errors (e.g. ESTK or AE scripting console).

---

## Release packaging

- Run **node scripts/validate-repo.js** and **node scripts/check-required-files.js** from the repo root before packaging.
- Ensure no real API keys are in the packaged artifact; ship **config/example.config.js** only; users add **runtime-config.js** locally.
- See [../../release-checklist.md](../../release-checklist.md).
