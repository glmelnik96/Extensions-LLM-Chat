# Required: CSInterface.js

**Scope:** Contents of **lib/** and how the extension uses them. For full CEP install and config, see the root README and config/README.md; do not duplicate those here.

The panel loads **CSInterface.js** from this folder. Without it you get:

`Failed to load resource: net::ERR_FILE_NOT_FOUND` for `CSInterface.js`

and the extension cannot talk to After Effects (no layer refresh, no apply expression).

## What to do

1. **Download CSInterface.js** from Adobe’s CEP-Resources:
   - Open: **https://github.com/Adobe-CEP/CEP-Resources**
   - Open the **CEP_11.x** folder (or **CEP_9.x** / **CEP_8.x** if 11 is not there).
   - Click **CSInterface.js**, then click **Raw** (or "Download").
   - Save the file as **CSInterface.js** into this folder:
     `Extensions LLM Chat/lib/`
   - You should end up with: `Extensions LLM Chat/lib/CSInterface.js`

2. **Reload the extension**: close the Extensions LLM Chat panel in After Effects and open it again (or restart AE).

After that, the Console error for CSInterface.js should go away and the panel can call `evalScript` to refresh layers and apply expressions.

## Optional: captureMacOS.js

**captureMacOS.js** is shipped in this folder. It uses Node (`child_process`) to run macOS `/usr/sbin/screencapture` for **full-screen** and **preview** capture in the panel. It requires **Node enabled in the CEP manifest** (`--enable-nodejs`, `--mixed-context` in `CSXS/manifest.xml`) and **Screen Recording** permission for After Effects. It does not replace CSInterface.js.

It also exposes **`purgeExtensionCapturePngs`**, which deletes `ext-llm-chat-capture-*.png` and `ext-llm-chat-frame-*.png` files from the system temp directory (used when the user chooses **Clear All**).

## ollamaVision.js

**ollamaVision.js** calls **Ollama** `POST /api/chat` with a PNG read via Node `fs`. On macOS, large images are downscaled with **`sips`** to **`ollamaVisionMaxEdgePx`** (default 1024) before upload to reduce GPU crashes. Requires Ollama running locally and the same CEP Node enablement as capture.
