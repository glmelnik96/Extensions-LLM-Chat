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

      /** ── Agent mode settings ─────────────────────────────────────────── */

      /** Maximum tool-call rounds per agent request. */
      agentMaxSteps: 150,

      /** Temperature for agent tool-use calls (lower = more precise tool usage). */
      agentTemperature: 0.3,
    }
  }
})()
