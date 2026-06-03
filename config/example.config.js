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
      /** Timeout for Cloud.ru chat requests (ms). Reasoning models (GLM-5.1 etc.)
       *  spend time "thinking" before the first token, so this is generous. */
      cloudChatTimeoutMs: 300000,
      /** Predetermined reasoning model — no panel selection. GLM-5.1 leads on
       *  tool-call schema adherence (lowest hallucinated-tool-name rate). */
      defaultModel: 'zai-org/GLM-5.1',
      fallbackModel: 'deepseek-ai/DeepSeek-V4-Pro',

      /** ── Agent mode settings ─────────────────────────────────────────── */

      /** Maximum tool-call rounds per agent request. Caps runaway loops/cost;
       *  observed worst case settled at ~27 rounds, so 60 leaves headroom. */
      agentMaxSteps: 60,

      /** Conversation history token budget before pruning. GLM-5.1 has a 202k
       *  context window, so this is set high to keep long sessions fully in
       *  context (quality over cost). */
      maxConversationTokens: 120000,

      /** Temperature for agent tool-use calls (lower = more precise tool usage). */
      agentTemperature: 0.3,
    }
  }
})()
