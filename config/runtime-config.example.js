/**
 * Optional overrides merged onto example.config.js (no API key — use secrets.local.js).
 * Copy to runtime-config.js and uncomment/adjust fields when upgrading from an older install.
 */
;(function () {
  'use strict'
  if (typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_CONFIG) {
    Object.assign(window.EXTENSIONS_LLM_CHAT_CONFIG, {
      // baseUrl: 'https://foundation-models.api.cloud.ru/v1',
      // defaultModel: 'zai-org/GLM-5.1',
      // fallbackModel: 'deepseek-ai/DeepSeek-V4-Pro',
      // cloudChatTimeoutMs: 300000,
      // agentMaxSteps: 60,
      // agentTemperature: 0.3,
      // maxConversationTokens: 120000,
    })
  }
})()
