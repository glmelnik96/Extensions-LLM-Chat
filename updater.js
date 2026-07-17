/**
 * Updater — GitHub self-update for the panel (dev/beta distribution).
 *
 * Shows the panel version in the footer and drives a two-click update flow:
 *   click 1: check latest commit on the repo branch via GitHub API
 *   click 2: download the tarball, extract to a staging dir, copy over the
 *            extension files, record the installed sha, reload the panel.
 *
 * Safety rails:
 *  - refuses to overwrite a git working copy (dev install) → use `git pull`;
 *  - secrets/runtime overrides are never touched (see PURE_UPDATER plan);
 *  - all archive bytes land in `.update-staging/` first, live files are only
 *    replaced after the whole archive extracted successfully;
 *  - native confirm() dialogs are avoided (unreliable in CEP) — the button
 *    itself becomes the confirmation step.
 *
 * NOTE: this in-place file swap only works for unsigned/dev installs
 * (PlayerDebugMode). A signed ZXP install verifies file hashes — the
 * commercial build must switch this module to "notify + install new ZXP".
 */
;(function () {
  'use strict'

  var API_TIMEOUT_MS = 15000
  var TARBALL_TIMEOUT_MS = 120000
  var STATE_FILE = 'update-state.json'
  var STAGING_DIR = '.update-staging'

  function cfg () {
    return (typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_CONFIG) || {}
  }

  function repoSlug () { return cfg().updateRepo || 'glmelnik96/Extensions-LLM-Chat' }
  function repoBranch () { return cfg().updateBranch || 'main' }

  function nodeMod (name) {
    try { return (typeof require === 'function') ? require(name) : null } catch (e) { return null }
  }

  /** Directory of index.html = extension root (handles file:// on Win/Mac). */
  function extensionRoot () {
    var p = decodeURIComponent(window.location.pathname)
    // Windows file URLs look like /C:/Users/... — drop the leading slash.
    if (/^\/[A-Za-z]:\//.test(p)) p = p.substring(1)
    var idx = p.lastIndexOf('/')
    return idx > 0 ? p.substring(0, idx) : p
  }

  // ── Local state ────────────────────────────────────────────────────────

  /** Installed sha: update-state.json, else .git/HEAD (dev clone), else null. */
  function readInstalledSha (fs, path, root) {
    try {
      var stateRaw = fs.readFileSync(path.join(root, STATE_FILE), 'utf8')
      var state = JSON.parse(stateRaw)
      if (state && typeof state.sha === 'string') return state.sha
    } catch (e) { /* no state file — fall through */ }
    try {
      var head = fs.readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim()
      if (/^[0-9a-f]{40}$/.test(head)) return head
      var m = head.match(/^ref:\s*(\S+)/)
      if (m) {
        var sha = fs.readFileSync(path.join(root, '.git', m[1].replace(/\//g, path.sep)), 'utf8').trim()
        if (/^[0-9a-f]{40}$/.test(sha)) return sha
      }
    } catch (e2) { /* not a git clone */ }
    return null
  }

  function isGitInstall (fs, path, root) {
    try { return fs.existsSync(path.join(root, '.git')) } catch (e) { return false }
  }

  function manifestVersion (fs, path, root) {
    try {
      var xml = fs.readFileSync(path.join(root, 'CSXS', 'manifest.xml'), 'utf8')
      var m = xml.match(/ExtensionBundleVersion="([^"]+)"/)
      return m ? m[1] : ''
    } catch (e) { return '' }
  }

  // ── Network ────────────────────────────────────────────────────────────

  function fetchWithTimeout (url, timeoutMs, asBuffer) {
    var controller = new AbortController()
    var timer = setTimeout(function () { controller.abort() }, timeoutMs)
    return fetch(url, {
      headers: { 'Accept': asBuffer ? 'application/vnd.github.tarball' : 'application/vnd.github+json' },
      signal: controller.signal
    }).then(function (res) {
      if (!res.ok) throw new Error('GitHub HTTP ' + res.status)
      return asBuffer ? res.arrayBuffer() : res.json()
    }).then(function (out) {
      clearTimeout(timer)
      return out
    }, function (err) {
      clearTimeout(timer)
      throw (err && err.name === 'AbortError') ? new Error('GitHub timeout after ' + timeoutMs + 'ms') : err
    })
  }

  // ── Core flows ─────────────────────────────────────────────────────────

  /** @returns Promise<{localSha, remoteSha, remoteDate, updateAvailable, isGit}> */
  function checkForUpdate () {
    var fs = nodeMod('fs')
    var path = nodeMod('path')
    if (!fs || !path) return Promise.reject(new Error('Node API unavailable in this host'))
    var root = extensionRoot()
    var url = 'https://api.github.com/repos/' + repoSlug() + '/commits/' + repoBranch()
    return fetchWithTimeout(url, API_TIMEOUT_MS, false).then(function (json) {
      if (!json || typeof json.sha !== 'string') throw new Error('Unexpected GitHub API response')
      var localSha = readInstalledSha(fs, path, root)
      return {
        localSha: localSha,
        remoteSha: json.sha,
        remoteDate: (json.commit && json.commit.committer && json.commit.committer.date) || '',
        updateAvailable: !localSha || localSha !== json.sha,
        isGit: isGitInstall(fs, path, root)
      }
    })
  }

  /** Download + extract + install. @returns Promise<{filesWritten, sha}> */
  function applyUpdate (remoteSha, onProgress) {
    var fs = nodeMod('fs')
    var path = nodeMod('path')
    var zlib = nodeMod('zlib')
    var progress = onProgress || function () {}
    if (!fs || !path || !zlib) return Promise.reject(new Error('Node API unavailable in this host'))
    var pure = window.PURE_UPDATER
    if (!pure) return Promise.reject(new Error('PURE_UPDATER not loaded'))
    var root = extensionRoot()
    if (isGitInstall(fs, path, root)) {
      return Promise.reject(new Error('Dev install (git clone) — update with `git pull`, not the panel button.'))
    }

    progress('Downloading…')
    var url = 'https://api.github.com/repos/' + repoSlug() + '/tarball/' + remoteSha
    return fetchWithTimeout(url, TARBALL_TIMEOUT_MS, true).then(function (arrayBuf) {
      progress('Extracting…')
      var BufferCtor = nodeMod('buffer').Buffer
      var tarBytes = zlib.gunzipSync(BufferCtor.from(arrayBuf))
      var entries = pure.parseTar(tarBytes)
      var plan = pure.planUpdateFiles(entries)
      // Sanity: a panel update must at minimum carry these.
      var seen = {}
      for (var i = 0; i < plan.length; i++) seen[plan[i].path] = true
      if (!seen['index.html'] || !seen['main.js'] || !seen['CSXS/manifest.xml']) {
        throw new Error('Archive does not look like the panel repo (missing core files)')
      }

      // Phase 1: everything into staging.
      var staging = path.join(root, STAGING_DIR)
      try { fs.rmSync(staging, { recursive: true, force: true }) } catch (e) {}
      for (var s = 0; s < plan.length; s++) {
        var stagePath = path.join(staging, plan[s].path.replace(/\//g, path.sep))
        fs.mkdirSync(path.dirname(stagePath), { recursive: true })
        fs.writeFileSync(stagePath, BufferCtor.from(plan[s].data))
      }

      // Phase 2: copy staged files over live ones.
      progress('Installing…')
      for (var c = 0; c < plan.length; c++) {
        var rel = plan[c].path.replace(/\//g, path.sep)
        var livePath = path.join(root, rel)
        fs.mkdirSync(path.dirname(livePath), { recursive: true })
        fs.copyFileSync(path.join(staging, rel), livePath)
      }
      try { fs.rmSync(staging, { recursive: true, force: true }) } catch (e2) {}

      fs.writeFileSync(path.join(root, STATE_FILE), JSON.stringify({
        sha: remoteSha,
        updatedAt: new Date().toISOString(),
        filesWritten: plan.length
      }, null, 2))
      return { filesWritten: plan.length, sha: remoteSha }
    })
  }

  // ── Footer UI ──────────────────────────────────────────────────────────

  function initUi () {
    var versionEl = document.getElementById('version-info')
    var btn = document.getElementById('update-btn')
    if (!versionEl || !btn) return

    var fs = nodeMod('fs')
    var path = nodeMod('path')
    var pure = window.PURE_UPDATER
    var root = extensionRoot()

    function renderVersion () {
      var v = (fs && path) ? manifestVersion(fs, path, root) : ''
      var sha = (fs && path) ? readInstalledSha(fs, path, root) : null
      var text = 'v' + (v || '?')
      if (sha && pure) text += ' \u00b7 ' + pure.shortSha(sha)
      versionEl.textContent = text
      versionEl.title = 'Panel version' + (sha ? ' \u00b7 commit ' + sha : '')
    }
    renderVersion()

    var pendingSha = null // set when a check found an update → next click installs

    /** Revert the button to its idle state after `ms` (unless an install is pending). */
    function resetButton (ms) {
      setTimeout(function () {
        if (!pendingSha) { btn.textContent = 'Update'; btn.title = 'Check for updates on GitHub' }
      }, ms)
    }

    btn.title = 'Check for updates on GitHub'
    btn.addEventListener('click', function () {
      if (btn.disabled) return

      // Second click: install the update found by the first click.
      if (pendingSha) {
        var sha = pendingSha
        pendingSha = null
        btn.disabled = true
        applyUpdate(sha, function (msg) { btn.textContent = msg }).then(function (result) {
          btn.textContent = 'Reloading\u2026'
          btn.title = 'Updated to ' + sha + ' (' + result.filesWritten + ' files)'
          setTimeout(function () { window.location.reload() }, 700)
        }).catch(function (err) {
          btn.disabled = false
          btn.textContent = 'Update \u2715'
          btn.title = (err && err.message) || String(err)
          resetButton(6000)
        })
        return
      }

      // First click: check.
      btn.disabled = true
      btn.textContent = 'Checking\u2026'
      checkForUpdate().then(function (info) {
        btn.disabled = false
        if (!info.updateAvailable) {
          btn.textContent = 'Up to date \u2713'
          btn.title = 'Latest commit installed'
          resetButton(4000)
          return
        }
        if (info.isGit) {
          btn.textContent = 'git pull'
          btn.title = 'Update available (' + (pure ? pure.shortSha(info.remoteSha) : info.remoteSha) +
            ') but this is a git dev install \u2014 run `git pull` instead.'
          resetButton(8000)
          return
        }
        pendingSha = info.remoteSha
        btn.textContent = 'Install ' + (pure ? pure.shortSha(info.remoteSha) : '') + '?'
        btn.title = 'Click again to download and install commit ' + info.remoteSha +
          (info.remoteDate ? ' (' + info.remoteDate + ')' : '') + '. Panel will reload.'
      }).catch(function (err) {
        btn.disabled = false
        btn.textContent = 'Update \u2715'
        btn.title = (err && err.message) || String(err)
        resetButton(6000)
      })
    })
  }

  var api = {
    checkForUpdate: checkForUpdate,
    applyUpdate: applyUpdate,
    extensionRoot: extensionRoot
  }
  if (typeof window !== 'undefined') {
    window.UPDATER = api
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initUi)
    } else {
      initUi()
    }
  }
})()
