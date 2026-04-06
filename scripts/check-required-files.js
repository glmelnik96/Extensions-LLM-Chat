#!/usr/bin/env node
/**
 * Check that prompt-library, knowledge-base, and config files expected by the runtime exist.
 * Run from repo root: node scripts/check-required-files.js
 */
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')

const PROMPT_LIBRARY_FILES = [
  'prompt-library/promptsBundle.js',
  'prompt-library/generator/system.md',
  'prompt-library/validator/system.md',
  'prompt-library/repair/system.md',
]

const KNOWLEDGE_BASE_FILES = [
  'knowledge-base/index/corpusIndex.js',
  'knowledge-base/README.md',
]

const CONFIG_FILES = [
  'config/example.config.js',
]

const DOCS_FILES = [
  'docs/configuration.md',
  'docs/secret-handling.md',
  'docs/final-architecture.md',
  'docs/capabilities-and-roadmap.md',
]

function check (label, list) {
  let failed = 0
  for (const rel of list) {
    const full = path.join(REPO_ROOT, rel)
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      console.error('Missing:', rel)
      failed++
    }
  }
  if (failed > 0) {
    console.error(label + ':', failed, 'missing')
    return failed
  }
  console.log(label + ': OK')
  return 0
}

function main () {
  let total = 0
  total += check('Prompt library', PROMPT_LIBRARY_FILES)
  total += check('Knowledge base', KNOWLEDGE_BASE_FILES)
  total += check('Config', CONFIG_FILES)
  total += check('Docs (expected)', DOCS_FILES)

  if (total > 0) {
    process.exit(1)
  }
  console.log('All required files present.')
  process.exit(0)
}

main()
