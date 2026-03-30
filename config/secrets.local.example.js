/**
 * API key and other secrets — copy to secrets.local.js (gitignored) and fill in.
 * Never commit secrets.local.js.
 *
 *   cp config/secrets.local.example.js config/secrets.local.js
 *
 * Load order in index.html: example.config.js → runtime-config.js → secrets.local.js
 * Secrets override EXTENSIONS_LLM_CHAT_CONFIG.apiKey when set.
 */
;(function () {
  'use strict'
  if (typeof window !== 'undefined') {
    window.EXTENSIONS_LLM_CHAT_SECRETS = {
      // Paste your Cloud.ru Foundation Models Bearer token (no "Bearer " prefix).
      apiKey: '',
    }
  }
})()
