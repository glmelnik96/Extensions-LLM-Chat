/**
 * Optional overrides merged onto example.config.js (no API key — use secrets.local.js).
 * Copy to runtime-config.js and uncomment/adjust fields when upgrading from an older install.
 */
;(function () {
  'use strict'
  if (typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_CONFIG) {
    Object.assign(window.EXTENSIONS_LLM_CHAT_CONFIG, {
      // baseUrl: 'https://foundation-models.api.cloud.ru/v1',
      // defaultModel: 'openai/gpt-oss-120b',
      // fallbackModel: 'Qwen/Qwen3-Coder-Next',
      // ollamaBaseUrl: 'http://127.0.0.1:11434',
      // ollamaVisionModel: 'llava-phi3:latest',
      // ollamaVisionFallbackModel: 'moondream:latest',
      // captureEnabled: true,
      // captureTimeoutMs: 15000,
      // previewCaptureInset: { leftFrac: 0.24, topFrac: 0.13, widthFrac: 0.5, heightFrac: 0.45 },
      // ollamaVisionTimeoutMs: 90000,
      // ollamaVisionMaxEdgePx: 1024,
    })
  }
})()
