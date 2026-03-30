/**
 * macOS screen capture via `screencapture` (+ AppleScript for AE window bounds for preview crop).
 * Requires CEP Node (CSXS/manifest.xml: --enable-nodejs, --mixed-context).
 * After Effects needs Screen Recording; comp-area capture may need Automation for System Events.
 *
 * Optional future: `screencapture -l <windowID>` (per-window capture) is not implemented — window IDs
 * and AE process names vary by macOS/AE version; full screen + `-R` rectangle + comp-area flow covers current needs.
 *
 * Exposes: window.EXTENSIONS_LLM_CHAT_CAPTURE_MACOS
 */
;(function () {
  'use strict'

  var SCREENCAPTURE_BIN = '/usr/sbin/screencapture'
  var OSASCRIPT_BIN = '/usr/bin/osascript'

  function isNodeCaptureAvailable () {
    if (typeof require === 'undefined') return false
    try {
      require('child_process')
      require('fs')
      require('os')
      require('path')
      return true
    } catch (e) {
      return false
    }
  }

  /**
   * @param {function (Error|null, { deletedCount: number, errors: string[] }|null)} callback
   */
  function purgeExtensionCapturePngs (callback) {
    if (typeof callback !== 'function') return
    if (!isNodeCaptureAvailable()) {
      callback(new Error('Node.js is not available; cannot purge capture files.'), null)
      return
    }
    var fs = require('fs')
    var os = require('os')
    var path = require('path')
    var dir = os.tmpdir()
    var deletedCount = 0
    var errors = []
    try {
      var names = fs.readdirSync(dir)
      for (var i = 0; i < names.length; i++) {
        var name = names[i]
        var isCapture = name.indexOf('ext-llm-chat-capture-') === 0
        var isFrame = name.indexOf('ext-llm-chat-frame-') === 0
        if ((!isCapture && !isFrame) || name.slice(-4) !== '.png') continue
        var full = path.join(dir, name)
        try {
          fs.unlinkSync(full)
          deletedCount++
        } catch (e) {
          errors.push(name + ': ' + (e && e.message ? e.message : String(e)))
        }
      }
      callback(null, { deletedCount: deletedCount, errors: errors })
    } catch (e) {
      callback(e instanceof Error ? e : new Error(String(e)), null)
    }
  }

  function getTempPngPath (prefix) {
    if (!isNodeCaptureAvailable()) return ''
    var path = require('path')
    var os = require('os')
    var pfx = typeof prefix === 'string' && prefix.length ? prefix : 'ext-llm-chat-temp'
    return path.join(
      os.tmpdir(),
      pfx + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png'
    )
  }

  function runScreencapturePng (args, timeoutMs, outPath, callback) {
    var cp = require('child_process')
    var fs = require('fs')
    cp.execFile(
      SCREENCAPTURE_BIN,
      args,
      { timeout: timeoutMs },
      function (err) {
        if (err) {
          var msg = err.message || String(err)
          if (/timeout|ETIMEDOUT|killed/i.test(msg)) {
            err = new Error(
              'Screen capture timed out. Check Screen Recording permission for After Effects.'
            )
          } else if (/permission|denied|not allowed/i.test(msg)) {
            err = new Error(
              'Screen capture was blocked. Grant Screen Recording to After Effects (System Settings → Privacy).'
            )
          }
          callback(err, null)
          return
        }
        try {
          if (!fs.existsSync(outPath)) {
            callback(new Error('screencapture finished but the PNG file is missing.'), null)
            return
          }
          callback(null, { path: outPath })
        } catch (e) {
          callback(e instanceof Error ? e : new Error(String(e)), null)
        }
      }
    )
  }

  /**
   * Full screen → PNG (all displays / full capture as per screencapture default without -R).
   */
  function captureFullScreenToPng (opts, callback) {
    if (typeof callback !== 'function') return
    if (!isNodeCaptureAvailable()) {
      callback(
        new Error(
          'Node.js is not available. Enable --enable-nodejs and --mixed-context in manifest.xml.'
        ),
        null
      )
      return
    }
    var path = require('path')
    var os = require('os')
    var o = opts || {}
    var timeoutMs = typeof o.captureTimeoutMs === 'number' && o.captureTimeoutMs > 0 ? o.captureTimeoutMs : 15000
    var outPath = path.join(
      os.tmpdir(),
      'ext-llm-chat-capture-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png'
    )
    var args = ['-x', '-t', 'png', outPath]
    runScreencapturePng(args, timeoutMs, outPath, callback)
  }

  /**
   * Best-effort "composition viewer" crop: frontmost After Effects window from System Events,
   * then a fractional inset (config) to approximate the video preview (not pixel-perfect).
   */
  function captureAeCompositionPreviewApproxToPng (opts, callback) {
    if (typeof callback !== 'function') return
    if (!isNodeCaptureAvailable()) {
      callback(
        new Error(
          'Node.js is not available. Enable --enable-nodejs and --mixed-context in manifest.xml.'
        ),
        null
      )
      return
    }
    var cp = require('child_process')
    var path = require('path')
    var os = require('os')
    var o = opts || {}
    var timeoutMs = typeof o.captureTimeoutMs === 'number' && o.captureTimeoutMs > 0 ? o.captureTimeoutMs : 15000
    var inset = o.previewCaptureInset || {}
    var leftFrac = typeof inset.leftFrac === 'number' ? inset.leftFrac : 0.24
    var topFrac = typeof inset.topFrac === 'number' ? inset.topFrac : 0.13
    var widthFrac = typeof inset.widthFrac === 'number' ? inset.widthFrac : 0.5
    var heightFrac = typeof inset.heightFrac === 'number' ? inset.heightFrac : 0.45

    // Prefer frontmost app when it is After Effects (CEP panel is inside AE). Then any AE process
    // whose name contains "After Effects" (covers 2023–2026, Beta, localized installs). Skip Render Engine.
    var appleScript =
      'tell application "System Events"\n' +
      '  set coords to ""\n' +
      '  try\n' +
      '    set fp to first application process whose frontmost is true\n' +
      '    set fn to name of fp as text\n' +
      '    if fn contains "After Effects" and fn does not contain "Render" then\n' +
      '      tell fp\n' +
      '        if (count of windows) > 0 then\n' +
      '          set p to position of window 1\n' +
      '          set s to size of window 1\n' +
      '          set coords to (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text)\n' +
      '        end if\n' +
      '      end tell\n' +
      '    end if\n' +
      '  end try\n' +
      '  if coords is "" then\n' +
      '    repeat with ap in (every application process whose name contains "After Effects")\n' +
      '      set nm to name of ap as text\n' +
      '      if nm does not contain "Render" then\n' +
      '        tell ap\n' +
      '          if (count of windows) > 0 then\n' +
      '            set p to position of window 1\n' +
      '            set s to size of window 1\n' +
      '            set coords to (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text)\n' +
      '            exit repeat\n' +
      '          end if\n' +
      '        end tell\n' +
      '      end if\n' +
      '    end repeat\n' +
      '  end if\n' +
      'end tell\n' +
      'return coords'

    cp.execFile(OSASCRIPT_BIN, ['-e', appleScript], { timeout: 12000 }, function (err, stdout) {
      if (err) {
        callback(
          new Error(
            'Could not read After Effects window (AppleScript). Grant Automation for After Effects → System Events, or use full screen capture. ' +
              (err.message || String(err))
          ),
          null
        )
        return
      }
      var raw = (stdout && String(stdout).trim()) || ''
      var parts = raw.split(',')
      if (parts.length !== 4) {
        callback(
          new Error(
            'No After Effects window found for comp-area capture. Focus After Effects, allow Automation (AE → System Events), or use Capture full screen.'
          ),
          null
        )
        return
      }
      var wx = parseInt(parts[0], 10)
      var wy = parseInt(parts[1], 10)
      var ww = parseInt(parts[2], 10)
      var wh = parseInt(parts[3], 10)
      if (!(ww > 80 && wh > 80)) {
        callback(new Error('After Effects window size is too small for preview capture.'), null)
        return
      }
      var ix = Math.round(wx + ww * leftFrac)
      var iy = Math.round(wy + wh * topFrac)
      var iw = Math.round(ww * widthFrac)
      var ih = Math.round(wh * heightFrac)
      if (iw < 64 || ih < 64) {
        callback(new Error('Computed preview rectangle is too small; adjust previewCaptureInset in config.'), null)
        return
      }
      var region = ix + ',' + iy + ',' + iw + ',' + ih
      var outPath = path.join(
        os.tmpdir(),
        'ext-llm-chat-capture-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png'
      )
      var args = ['-x', '-t', 'png', '-R', region, outPath]
      runScreencapturePng(args, timeoutMs, outPath, callback)
    })
  }

  if (typeof window !== 'undefined') {
    window.EXTENSIONS_LLM_CHAT_CAPTURE_MACOS = {
      isNodeCaptureAvailable: isNodeCaptureAvailable,
      captureFullScreenToPng: captureFullScreenToPng,
      captureAeCompositionPreviewApproxToPng: captureAeCompositionPreviewApproxToPng,
      purgeExtensionCapturePngs: purgeExtensionCapturePngs,
      getTempPngPath: getTempPngPath,
    }
  }
})()
