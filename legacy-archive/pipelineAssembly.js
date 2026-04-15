/**
 * Grounded prompt assembly for the multi-pass pipeline. Uses prompt-library and knowledge-base.
 * Exposes window.PIPELINE_ASSEMBLY. If prompts or KB are missing, assembly returns empty and main.js uses built-in fallbacks.
 */
(function () {
  'use strict'

  var prompts = typeof window !== 'undefined' && window.PIPELINE_PROMPTS ? window.PIPELINE_PROMPTS : null
  var kb = typeof window !== 'undefined' && window.KB_CORPUS_INDEX ? window.KB_CORPUS_INDEX : null

  function getGroundingForRole (role) {
    if (!kb || typeof kb.getGroundingForProjection !== 'function') return ''
    try {
      return kb.getGroundingForProjection(role) || ''
    } catch (e) {
      return ''
    }
  }

  function getGeneratorSystemWithGrounding (groundingSnippets) {
    if (!prompts || !prompts.shared || !prompts.generator) return null
    var parts = [
      prompts.shared.projectContext,
      prompts.shared.outputContracts,
      prompts.shared.targetingRules,
      prompts.generator.system,
    ]
    var template = prompts.generator.groundingTemplate || ''
    var filled = template.replace(/\{\{GROUNDING_SNIPPETS\}\}/g, groundingSnippets || '')
    parts.push(filled)
    return parts.join('\n\n')
  }

  function getValidatorSystemWithGrounding (groundingSnippets) {
    if (!prompts || !prompts.shared || !prompts.validator) return null
    var parts = [
      prompts.shared.projectContext,
      prompts.shared.outputContracts,
      prompts.shared.targetingRules,
      prompts.validator.system,
      prompts.validator.reportSchema,
    ]
    var template = prompts.validator.groundingTemplate || ''
    var filled = template.replace(/\{\{GROUNDING_SNIPPETS\}\}/g, groundingSnippets || '')
    parts.push(filled)
    return parts.join('\n\n')
  }

  function getRepairSystemWithGrounding (groundingSnippets) {
    if (!prompts || !prompts.shared || !prompts.repair) return null
    var parts = [
      prompts.shared.projectContext,
      prompts.shared.outputContracts,
      prompts.shared.targetingRules,
      prompts.repair.system,
      prompts.repair.patchingPolicy,
    ]
    var template = prompts.repair.groundingTemplate || ''
    var filled = template.replace(/\{\{GROUNDING_SNIPPETS\}\}/g, groundingSnippets || '')
    parts.push(filled)
    return parts.join('\n\n')
  }

  if (typeof window !== 'undefined') {
    window.PIPELINE_ASSEMBLY = {
      getGroundingForRole: getGroundingForRole,
      getGeneratorSystemWithGrounding: getGeneratorSystemWithGrounding,
      getValidatorSystemWithGrounding: getValidatorSystemWithGrounding,
      getRepairSystemWithGrounding: getRepairSystemWithGrounding,
    }
  }
})()
