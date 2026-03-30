#!/usr/bin/env node
/**
 * Lightweight repository validation for the CEP extension.
 * Verifies required directories and integration points exist.
 * Run from repo root: node scripts/validate-repo.js
 */
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')

const REQUIRED_DIRS = [
  'config',
  'docs',
  'host',
  'knowledge-base',
  'knowledge-base/index',
  'knowledge-base/corpus',
  'lib',
  'prompt-library',
  'scripts',
]

const REQUIRED_FILES = [
  'index.html',
  'main.js',
  'diagnostics.js',
  'config/example.config.js',
  'config/secrets.local.example.js',
  'config/runtime-config.example.js',
  'config/README.md',
  'knowledge-base/index/corpusIndex.js',
  'prompt-library/promptsBundle.js',
  'prompt-library/agent/README.md',
  'pipelineAssembly.js',
  'systemPrompt.js',
  'lib/captureMacOS.js',
  'lib/ollamaVision.js',
  'lib/CSInterface.js',
  'host/index.jsx',
  'CSXS/manifest.xml',
]

function exists (relPath) {
  const full = path.join(REPO_ROOT, relPath)
  return fs.existsSync(full)
}

function isFile (relPath) {
  const full = path.join(REPO_ROOT, relPath)
  try {
    return fs.existsSync(full) && fs.statSync(full).isFile()
  } catch (_) {
    return false
  }
}

function main () {
  let failed = 0

  for (const dir of REQUIRED_DIRS) {
    if (!exists(dir)) {
      console.error('Missing directory:', dir)
      failed++
    }
  }

  for (const file of REQUIRED_FILES) {
    if (!isFile(file)) {
      console.error('Missing file:', file)
      failed++
    }
  }

  if (failed > 0) {
    console.error('Validation failed:', failed, 'missing item(s)')
    process.exit(1)
  }

  console.log('Repository structure OK')
  process.exit(0)
}

main()
