/**
 * Default configuration (tracked). API key lives in secrets.local.js (gitignored).
 * Optional: copy runtime-config.example.js → runtime-config.js for non-secret overrides.
 */
(function () {
  'use strict'
  if (typeof window !== 'undefined') {
    window.EXTENSIONS_LLM_CHAT_CONFIG = {
      /** Overridden by config/secrets.local.js when apiKey is set there. */
      apiKey: '',
      baseUrl: 'https://foundation-models.api.cloud.ru/v1',
      /** Timeout for Cloud.ru chat requests (ms). */
      cloudChatTimeoutMs: 120000,
      defaultModel: 'openai/gpt-oss-120b',
      fallbackModel: 'Qwen/Qwen3-Coder-Next',

      /** Local Ollama HTTP API (used in later phases for vision). */
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      /** Vision models (example install: ollama pull llava-phi3:latest && ollama pull moondream:latest). */
      ollamaVisionModel: 'llava-phi3:latest',
      ollamaVisionFallbackModel: 'moondream:latest',

      /** macOS screen capture. Requires Node in manifest + Screen Recording for AE. */
      captureEnabled: true,
      captureTimeoutMs: 15000,

      /**
       * Fractional crop inside the frontmost After Effects window for "Capture comp area"
       * (approximates the composition viewer; tune if your workspace layout differs).
       */
      previewCaptureInset: { leftFrac: 0.24, topFrac: 0.13, widthFrac: 0.5, heightFrac: 0.45 },

      /** Vision request timeout (ms) for Ollama /api/chat with images. */
      ollamaVisionTimeoutMs: 90000,

      /**
       * Longest edge of PNG sent to Ollama (pixels). Larger comp frames are downscaled with macOS `sips`
       * before upload to avoid GPU OOM / "model runner has unexpectedly stopped". Set 0 to disable.
       */
      ollamaVisionMaxEdgePx: 1024,

      /** ── Agent mode settings ─────────────────────────────────────────── */

      /** Ollama chat model for full agent conversation (not just vision). */
      ollamaChatModel: 'qwen2.5:14b',

      /** Enable Ollama as a chat provider option (requires a running Ollama instance). */
      ollamaChatEnabled: false,

      /** Timeout for Ollama chat requests (ms). */
      ollamaChatTimeoutMs: 120000,

      /** Default provider: 'cloudru' or 'ollama'. */
      defaultProvider: 'cloudru',

      /** Maximum tool-call rounds per agent request. */
      agentMaxSteps: 150,

      /** Temperature for agent tool-use calls (lower = more precise tool usage). */
      agentTemperature: 0.3,
    }
  }
})()
