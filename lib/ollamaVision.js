/**
 * Local Ollama vision: POST /api/chat with a PNG file as base64.
 * Large frames are downscaled on macOS (sips) before upload to reduce GPU OOM / runner crashes.
 *
 * Exposes: window.EXTENSIONS_LLM_CHAT_OLLAMA_VISION
 */
;(function () {
  'use strict'

  var SIPS_BIN = '/usr/bin/sips'

  function isNodeFsAvailable () {
    if (typeof require === 'undefined') return false
    try {
      require('fs')
      return true
    } catch (e) {
      return false
    }
  }

  /** PNG IHDR width/height (big-endian), first chunk assumed IHDR. */
  function readPngIhdrDimensions (buf) {
    if (!buf || buf.length < 24) return null
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null
    var w = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19]
    var h = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23]
    if (!(w > 0 && h > 0 && w <= 32768 && h <= 32768)) return null
    return { width: w, height: h }
  }

  /**
   * If image longest edge > maxEdgePx, resize with macOS sips (-Z). Returns buffer + optional temp path to unlink.
   * @returns {{ buffer: Buffer, tempPath: string|null, didResize: boolean }}
   */
  function preparePngBufferForOllama (imagePath, maxEdgePx, fs, pathMod, os, cp) {
    var buf = fs.readFileSync(imagePath)
    if (!buf || buf.length < 64) {
      return { buffer: buf, tempPath: null, didResize: false }
    }
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
      return { buffer: buf, tempPath: null, didResize: false }
    }
    if (typeof maxEdgePx !== 'number' || maxEdgePx <= 0) {
      return { buffer: buf, tempPath: null, didResize: false }
    }
    if (typeof process === 'undefined' || process.platform !== 'darwin') {
      return { buffer: buf, tempPath: null, didResize: false }
    }
    var dims = readPngIhdrDimensions(buf)
    if (!dims || Math.max(dims.width, dims.height) <= maxEdgePx) {
      return { buffer: buf, tempPath: null, didResize: false }
    }
    var outPath = pathMod.join(
      os.tmpdir(),
      'ext-llm-chat-ollama-resize-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png'
    )
    try {
      cp.execFileSync(SIPS_BIN, ['-Z', String(maxEdgePx), imagePath, '--out', outPath], { stdio: 'ignore' })
    } catch (e) {
      return { buffer: buf, tempPath: null, didResize: false }
    }
    try {
      var outBuf = fs.readFileSync(outPath)
      if (!outBuf || outBuf.length < 64) {
        try {
          fs.unlinkSync(outPath)
        } catch (e2) {}
        return { buffer: buf, tempPath: null, didResize: false }
      }
      return { buffer: outBuf, tempPath: outPath, didResize: true }
    } catch (e3) {
      try {
        fs.unlinkSync(outPath)
      } catch (e4) {}
      return { buffer: buf, tempPath: null, didResize: false }
    }
  }

  /**
   * @param {string} imagePath absolute path to PNG
   * @param {object} opts
   * @param {string} opts.baseUrl e.g. http://127.0.0.1:11434
   * @param {string} opts.model primary model
   * @param {string} [opts.fallbackModel]
   * @param {string} opts.prompt user instruction
   * @param {number} [opts.timeoutMs]
   * @param {number} [opts.maxEdgePx] longest edge cap before Ollama (macOS sips); 0 = off; default 1024
   * @param {function (Error|null, string|null)} callback assistant text or error
   */
  function analyzePngFile (imagePath, opts, callback) {
    if (typeof callback !== 'function') return
    if (!isNodeFsAvailable()) {
      callback(new Error('Node.js fs is not available.'), null)
      return
    }
    var fs = require('fs')
    var pathMod = require('path')
    var os = require('os')
    var cp = require('child_process')
    if (typeof imagePath !== 'string' || !imagePath.length) {
      callback(new Error('No image path.'), null)
      return
    }
    if (!fs.existsSync(imagePath)) {
      callback(new Error('Image file not found: ' + imagePath), null)
      return
    }

    var o = opts || {}
    var baseUrl = (typeof o.baseUrl === 'string' ? o.baseUrl : 'http://127.0.0.1:11434').replace(/\/$/, '')
    var model = typeof o.model === 'string' && o.model ? o.model : 'llava-phi3:latest'
    var fallback = typeof o.fallbackModel === 'string' ? o.fallbackModel : ''
    var prompt = typeof o.prompt === 'string' ? o.prompt : 'Describe the image briefly.'
    var timeoutMs = typeof o.timeoutMs === 'number' && o.timeoutMs > 0 ? o.timeoutMs : 120000
    var maxEdgePx =
      typeof o.maxEdgePx === 'number' && o.maxEdgePx >= 0 ? o.maxEdgePx : 1024

    var prep = preparePngBufferForOllama(imagePath, maxEdgePx, fs, pathMod, os, cp)
    var buf = prep.buffer
    var tempResizePath = prep.tempPath

    function cleanupResizeTemp () {
      if (!tempResizePath) return
      try {
        if (fs.existsSync(tempResizePath)) fs.unlinkSync(tempResizePath)
      } catch (e) {}
      tempResizePath = null
    }

    if (!buf || buf.length < 64) {
      cleanupResizeTemp()
      callback(new Error('Image file is empty or too small (' + (buf ? buf.length : 0) + ' bytes).'), null)
      return
    }
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
      cleanupResizeTemp()
      callback(new Error('File is not a PNG (missing PNG signature).'), null)
      return
    }
    var b64 = buf.toString('base64')
    if (!b64 || b64.length < 80) {
      cleanupResizeTemp()
      callback(new Error('PNG base64 payload is empty; file may be corrupt.'), null)
      return
    }

    function postChat (modelName, cb) {
      if (typeof fetch === 'undefined') {
        cleanupResizeTemp()
        cb(new Error('fetch is not available in this panel.'), null)
        return
      }
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null
      var timer = setTimeout(function () {
        if (controller) controller.abort()
      }, timeoutMs)

      fetch(baseUrl + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [
            {
              role: 'user',
              content: prompt,
              images: [b64],
            },
          ],
          stream: false,
        }),
        signal: controller ? controller.signal : undefined,
      })
        .then(function (res) {
          clearTimeout(timer)
          if (!res.ok) {
            return res.text().then(function (t) {
              throw new Error('Ollama HTTP ' + res.status + (t ? ': ' + t.slice(0, 200) : ''))
            })
          }
          return res.json()
        })
        .then(function (data) {
          var content = data && data.message && typeof data.message.content === 'string' ? data.message.content : ''
          content = content.trim()
          if (!content) {
            cb(new Error('Ollama returned empty content.'), null)
            return
          }
          cb(null, content)
        })
        .catch(function (err) {
          clearTimeout(timer)
          cb(err instanceof Error ? err : new Error(String(err)), null)
        })
    }

    function wrappedCallback (err, text) {
      cleanupResizeTemp()
      callback(err, text)
    }

    postChat(model, function (err, text) {
      if (!err || !fallback || fallback === model) {
        wrappedCallback(err, text)
        return
      }
      postChat(fallback, wrappedCallback)
    })
  }

  if (typeof window !== 'undefined') {
    window.EXTENSIONS_LLM_CHAT_OLLAMA_VISION = {
      isNodeFsAvailable: isNodeFsAvailable,
      analyzePngFile: analyzePngFile,
    }
  }
})()
