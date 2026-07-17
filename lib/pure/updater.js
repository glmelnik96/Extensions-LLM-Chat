/**
 * Updater (pure) — tar parsing and file planning for the GitHub self-updater.
 *
 * Parses GitHub tarballs (ustar + pax entries) after gunzip and turns them
 * into a safe write plan: first path component stripped (GitHub prefixes
 * `owner-repo-sha/`), paths sanitized against traversal, protected local
 * files (secrets, runtime overrides, updater state) never overwritten.
 *
 * No IO, no globals beyond `window` export: works in the browser panel and
 * under node:test via the same vm.runInContext loader other pure modules use.
 */
;(function () {
  'use strict'

  // Local files the update must never touch (user-owned or updater-owned).
  var PROTECTED_PATHS = [
    'config/secrets.local.js',
    'config/runtime-config.js',
    'update-state.json'
  ]

  // ── Small byte helpers (no TextDecoder — vm test realm lacks it) ──────

  /** Decode a NUL-terminated UTF-8 byte range into a JS string. */
  function utf8Field (u8, off, len) {
    var end = off
    var max = off + len
    while (end < max && u8[end] !== 0) end++
    var out = ''
    var i = off
    while (i < end) {
      var b = u8[i]
      if (b < 0x80) { out += String.fromCharCode(b); i += 1 }
      else if (b < 0xE0 && i + 1 < end) {
        out += String.fromCharCode(((b & 0x1F) << 6) | (u8[i + 1] & 0x3F)); i += 2
      } else if (b < 0xF0 && i + 2 < end) {
        out += String.fromCharCode(((b & 0x0F) << 12) | ((u8[i + 1] & 0x3F) << 6) | (u8[i + 2] & 0x3F)); i += 3
      } else if (i + 3 < end) {
        var cp = ((b & 0x07) << 18) | ((u8[i + 1] & 0x3F) << 12) | ((u8[i + 2] & 0x3F) << 6) | (u8[i + 3] & 0x3F)
        cp -= 0x10000
        out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF))
        i += 4
      } else { out += '\uFFFD'; i += 1 }
    }
    return out
  }

  /** Parse an octal numeric tar field (digits, may be space/NUL padded). */
  function octalField (u8, off, len) {
    var val = 0
    var seen = false
    for (var i = off; i < off + len; i++) {
      var b = u8[i]
      if (b === 0 || b === 32) { if (seen) break; continue }
      if (b < 48 || b > 55) break
      val = val * 8 + (b - 48)
      seen = true
    }
    return seen ? val : null
  }

  /** Verify ustar header checksum (checksum field counted as spaces). */
  function checksumOk (u8, off) {
    var stored = octalField(u8, off + 148, 8)
    if (stored === null) return false
    var sum = 0
    for (var i = 0; i < 512; i++) {
      sum += (i >= 148 && i < 156) ? 32 : u8[off + i]
    }
    return sum === stored
  }

  function isZeroBlock (u8, off) {
    for (var i = 0; i < 512; i++) {
      if (u8[off + i] !== 0) return false
    }
    return true
  }

  // ── Tar parsing ────────────────────────────────────────────────────────

  /**
   * Parse a tar archive (Uint8Array, already gunzipped).
   * Returns entries: [{ name, type, size, data: Uint8Array }].
   * Regular files only carry data; pax/global/gnu-longname entries are
   * skipped (their data too). Throws on structural corruption.
   */
  function parseTar (u8) {
    if (!u8 || typeof u8.length !== 'number') throw new Error('parseTar: not a byte array')
    var entries = []
    var off = 0
    while (off + 512 <= u8.length) {
      if (isZeroBlock(u8, off)) break // end-of-archive marker
      if (!checksumOk(u8, off)) {
        throw new Error('parseTar: header checksum mismatch at offset ' + off)
      }
      var name = utf8Field(u8, off, 100)
      var size = octalField(u8, off + 124, 12)
      if (size === null) throw new Error('parseTar: bad size field at offset ' + off)
      var type = u8[off + 156]
      // ustar prefix field extends the name (magic "ustar" at 257).
      var hasUstarMagic = u8[off + 257] === 117 && u8[off + 258] === 115 &&
        u8[off + 259] === 116 && u8[off + 260] === 97 && u8[off + 261] === 114
      if (hasUstarMagic) {
        var prefix = utf8Field(u8, off + 345, 155)
        if (prefix) name = prefix + '/' + name
      }
      var dataStart = off + 512
      var dataEnd = dataStart + size
      if (dataEnd > u8.length) throw new Error('parseTar: truncated entry "' + name + '"')

      // Typeflag: '0' (48) or NUL = regular file; '5' (53) = directory;
      // 'x'/'g'/'L' etc = metadata entries we skip along with their data.
      var typeChar = (type === 0) ? '0' : String.fromCharCode(type)
      entries.push({
        name: name,
        type: typeChar,
        size: size,
        data: (typeChar === '0') ? u8.subarray(dataStart, dataEnd) : null
      })

      off = dataStart + Math.ceil(size / 512) * 512
    }
    return entries
  }

  // ── Path handling ──────────────────────────────────────────────────────

  /** Drop the leading `owner-repo-sha/` component of GitHub tarball paths. */
  function stripFirstComponent (name) {
    var idx = name.indexOf('/')
    if (idx === -1) return null
    var rest = name.substring(idx + 1)
    return rest || null
  }

  /**
   * Sanitize a tar entry path into a safe relative path (forward slashes).
   * Returns null for anything suspicious: traversal, absolute paths,
   * backslashes, drive letters, empty segments.
   */
  function sanitizeRelPath (name) {
    if (!name || typeof name !== 'string') return null
    if (name.indexOf('\\') !== -1) return null
    if (name.charAt(0) === '/') return null
    if (/^[A-Za-z]:/.test(name)) return null
    var parts = name.split('/')
    var clean = []
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i]
      if (p === '' || p === '.') continue
      if (p === '..') return null
      clean.push(p)
    }
    return clean.length ? clean.join('/') : null
  }

  /**
   * Turn parsed tar entries into a write plan for the extension root.
   * Only regular files; GitHub prefix stripped; paths sanitized; protected
   * paths and .git/ excluded. Returns [{ path, data }].
   */
  function planUpdateFiles (entries, protectedPaths) {
    var prot = protectedPaths || PROTECTED_PATHS
    var plan = []
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i]
      if (e.type !== '0' || !e.data) continue
      if (e.name === 'pax_global_header') continue
      var stripped = stripFirstComponent(e.name)
      if (!stripped) continue
      var rel = sanitizeRelPath(stripped)
      if (!rel) continue
      if (rel === '.git' || rel.indexOf('.git/') === 0) continue
      var isProtected = false
      for (var j = 0; j < prot.length; j++) {
        if (rel === prot[j]) { isProtected = true; break }
      }
      if (isProtected) continue
      plan.push({ path: rel, data: e.data })
    }
    return plan
  }

  function shortSha (sha) {
    return (typeof sha === 'string') ? sha.substring(0, 7) : ''
  }

  var api = {
    parseTar: parseTar,
    stripFirstComponent: stripFirstComponent,
    sanitizeRelPath: sanitizeRelPath,
    planUpdateFiles: planUpdateFiles,
    shortSha: shortSha,
    PROTECTED_PATHS: PROTECTED_PATHS
  }

  if (typeof window !== 'undefined') window.PURE_UPDATER = api
})()
