/**
 * Model access (2026-10-18) — which models THIS Cloud.ru project may call.
 *
 * Why: GET /models lists the whole endpoint catalog (90 models on
 * 2026-10-18), not what the project behind the API key is allowed to use.
 * The same key that ran the eval corpus on gpt-oss-120b on 2026-09-03 got
 * HTTP 403 "Requested model is not available for this project" on
 * 2026-10-18 for 70 catalog models — the panel default gpt-oss-120b, the
 * selector's Kimi-K2.6, the visual-check model MiniMax-M3 and Whisper among
 * them — while the availability badge, which reads only the catalog, still
 * showed "4/4".
 *
 * config.unavailableModels (example.config.js) names the ids the project
 * cannot call. The panel hides them from the model selector, turns the
 * visual check off when its model is listed, and disables transcription
 * (button + transcribe_comp_audio) when the Whisper model is listed. When
 * access comes back, delete the id from that list — no code change needed.
 *
 * Browser global PURE_MODEL_ACCESS; also require()-able for node tests.
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.PURE_MODEL_ACCESS = api
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict'

  var DEFAULT_TRANSCRIBE_MODEL = 'openai/whisper-large-v3'

  function unavailableList (cfg) {
    var list = cfg && cfg.unavailableModels
    return Array.isArray(list) ? list : []
  }

  function isUnavailable (id, cfg) {
    if (!id) return false
    return unavailableList(cfg).indexOf(String(id)) !== -1
  }

  /**
   * Selector entries the project can call, in their original order. A config
   * that lists EVERY entry would leave the panel with no model at all, so in
   * that case the full list comes back unchanged: requests then fail with the
   * endpoint's own 403 text instead of the panel breaking on boot.
   */
  function filterModels (models, cfg) {
    var src = Array.isArray(models) ? models : []
    var out = []
    for (var i = 0; i < src.length; i++) {
      if (src[i] && !isUnavailable(src[i].id, cfg)) out.push(src[i])
    }
    return out.length ? out : src.slice()
  }

  function transcribeModelId (cfg) {
    return (cfg && cfg.transcribeModel) || DEFAULT_TRANSCRIBE_MODEL
  }

  function isTranscriptionAvailable (cfg) {
    return !isUnavailable(transcribeModelId(cfg), cfg)
  }

  return {
    unavailableList: unavailableList,
    isUnavailable: isUnavailable,
    filterModels: filterModels,
    transcribeModelId: transcribeModelId,
    isTranscriptionAvailable: isTranscriptionAvailable,
    DEFAULT_TRANSCRIBE_MODEL: DEFAULT_TRANSCRIBE_MODEL
  }
})
