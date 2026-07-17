/**
 * Tests for lib/pure/updater.js — tar parsing and update-plan pure functions.
 *
 * Tar fixtures are built by hand (ustar headers with valid checksums) so the
 * tests need no binary blobs and cover: regular files, dirs, pax metadata
 * skipping, ustar prefix joining, UTF-8 names, corruption detection.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadBrowserGlobal (file) {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const sandbox = { window: {}, console }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: file })
  return sandbox.window
}

const win = loadBrowserGlobal('lib/pure/updater.js')
const U = win.PURE_UPDATER

// ── Tar fixture builder ─────────────────────────────────────────────────────

/** Build one 512-byte ustar header + padded data blocks for an entry. */
function tarEntry (name, data, typeflag) {
  const body = typeof data === 'string' ? Buffer.from(data, 'utf8') : (data || Buffer.alloc(0))
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write('0000644\0', 100, 8, 'ascii') // mode
  header.write('0000000\0', 108, 8, 'ascii') // uid
  header.write('0000000\0', 116, 8, 'ascii') // gid
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii')
  header.write('00000000000\0', 136, 12, 'ascii') // mtime
  header[156] = (typeflag || '0').charCodeAt(0)
  header.write('ustar', 257, 5, 'ascii')
  header[263] = 0x30; header[264] = 0x30 // version "00"
  // Checksum: sum of header with checksum field as spaces.
  header.fill(0x20, 148, 156)
  let sum = 0
  for (let i = 0; i < 512; i++) sum += header[i]
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')

  const padded = Math.ceil(body.length / 512) * 512
  const blocks = Buffer.alloc(padded)
  body.copy(blocks)
  return Buffer.concat([header, blocks])
}

/** Concatenate entries + two zero end-of-archive blocks into a Uint8Array. */
function tarArchive (entryBufs) {
  return new Uint8Array(Buffer.concat([...entryBufs, Buffer.alloc(1024)]))
}

function plain (v) { return JSON.parse(JSON.stringify(v)) }
function dataStr (entry) { return Buffer.from(entry.data).toString('utf8') }

// ── Module loading ──────────────────────────────────────────────────────────

test('updater: module loads with expected exports', () => {
  assert.ok(U, 'PURE_UPDATER exists')
  assert.strictEqual(typeof U.parseTar, 'function')
  assert.strictEqual(typeof U.stripFirstComponent, 'function')
  assert.strictEqual(typeof U.sanitizeRelPath, 'function')
  assert.strictEqual(typeof U.planUpdateFiles, 'function')
  assert.strictEqual(typeof U.shortSha, 'function')
  assert.ok(Array.isArray(U.PROTECTED_PATHS))
})

// ── parseTar ────────────────────────────────────────────────────────────────

test('parseTar: regular files with data, dirs without', () => {
  const tar = tarArchive([
    tarEntry('repo-abc/', null, '5'),
    tarEntry('repo-abc/index.html', '<html>hi</html>'),
    tarEntry('repo-abc/main.js', 'var x = 1\n')
  ])
  const entries = U.parseTar(tar)
  assert.strictEqual(entries.length, 3)
  assert.strictEqual(entries[0].type, '5')
  assert.strictEqual(entries[0].data, null)
  assert.strictEqual(entries[1].name, 'repo-abc/index.html')
  assert.strictEqual(entries[1].type, '0')
  assert.strictEqual(dataStr(entries[1]), '<html>hi</html>')
  assert.strictEqual(dataStr(entries[2]), 'var x = 1\n')
})

test('parseTar: NUL typeflag treated as regular file', () => {
  const buf = tarEntry('repo/a.txt', 'abc', '0')
  buf[156] = 0
  // Fix checksum after mutating typeflag: recompute.
  buf.fill(0x20, 148, 156)
  let sum = 0
  for (let i = 0; i < 512; i++) sum += buf[i]
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
  const entries = U.parseTar(tarArchive([buf]))
  assert.strictEqual(entries[0].type, '0')
  assert.strictEqual(dataStr(entries[0]), 'abc')
})

test('parseTar: pax metadata entries carry no data and their bytes are skipped', () => {
  const tar = tarArchive([
    tarEntry('pax_global_header', '52 comment=deadbeef\n', 'g'),
    tarEntry('repo/file.txt', 'payload')
  ])
  const entries = U.parseTar(tar)
  assert.strictEqual(entries.length, 2)
  assert.strictEqual(entries[0].type, 'g')
  assert.strictEqual(entries[0].data, null)
  assert.strictEqual(entries[1].name, 'repo/file.txt')
  assert.strictEqual(dataStr(entries[1]), 'payload')
})

test('parseTar: ustar prefix field joins onto the name', () => {
  const buf = tarEntry('deep.txt', 'x')
  buf.write('repo-abc/some/long/dir', 345, 155, 'ascii')
  buf.fill(0x20, 148, 156)
  let sum = 0
  for (let i = 0; i < 512; i++) sum += buf[i]
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
  const entries = U.parseTar(tarArchive([buf]))
  assert.strictEqual(entries[0].name, 'repo-abc/some/long/dir/deep.txt')
})

test('parseTar: UTF-8 names decode correctly', () => {
  const tar = tarArchive([tarEntry('repo/докс/файл.md', 'привет')])
  const entries = U.parseTar(tar)
  assert.strictEqual(entries[0].name, 'repo/докс/файл.md')
})

test('parseTar: throws on checksum mismatch', () => {
  const buf = tarEntry('repo/a.txt', 'abc')
  buf[0] ^= 0xff // corrupt name byte without fixing checksum
  assert.throws(() => U.parseTar(tarArchive([buf])), /checksum mismatch/)
})

test('parseTar: throws on truncated entry', () => {
  const buf = tarEntry('repo/a.txt', 'abcdef')
  const truncated = new Uint8Array(buf.subarray(0, 512)) // header only, no data
  assert.throws(() => U.parseTar(truncated), /truncated/)
})

test('parseTar: stops at zero end-of-archive block', () => {
  const garbageAfterEnd = Buffer.alloc(512, 0xaa)
  const tar = new Uint8Array(Buffer.concat([
    tarEntry('repo/a.txt', 'x'), Buffer.alloc(1024), garbageAfterEnd
  ]))
  const entries = U.parseTar(tar)
  assert.strictEqual(entries.length, 1)
})

test('parseTar: rejects non-byte-array input', () => {
  assert.throws(() => U.parseTar(null), /not a byte array/)
})

// ── stripFirstComponent ─────────────────────────────────────────────────────

test('stripFirstComponent: drops GitHub owner-repo-sha prefix', () => {
  assert.strictEqual(U.stripFirstComponent('owner-repo-abc123/lib/pure/x.js'), 'lib/pure/x.js')
  assert.strictEqual(U.stripFirstComponent('owner-repo-abc123/index.html'), 'index.html')
  assert.strictEqual(U.stripFirstComponent('owner-repo-abc123/'), null)
  assert.strictEqual(U.stripFirstComponent('no-slash'), null)
})

// ── sanitizeRelPath ─────────────────────────────────────────────────────────

test('sanitizeRelPath: accepts clean relative paths', () => {
  assert.strictEqual(U.sanitizeRelPath('index.html'), 'index.html')
  assert.strictEqual(U.sanitizeRelPath('lib/pure/updater.js'), 'lib/pure/updater.js')
  assert.strictEqual(U.sanitizeRelPath('a//b/./c'), 'a/b/c')
})

test('sanitizeRelPath: rejects traversal and absolute forms', () => {
  assert.strictEqual(U.sanitizeRelPath('../evil.js'), null)
  assert.strictEqual(U.sanitizeRelPath('a/../../evil.js'), null)
  assert.strictEqual(U.sanitizeRelPath('/etc/passwd'), null)
  assert.strictEqual(U.sanitizeRelPath('C:/Windows/evil.js'), null)
  assert.strictEqual(U.sanitizeRelPath('a\\b.js'), null)
  assert.strictEqual(U.sanitizeRelPath(''), null)
  assert.strictEqual(U.sanitizeRelPath(null), null)
})

// ── planUpdateFiles ─────────────────────────────────────────────────────────

test('planUpdateFiles: files only, prefix stripped, protected + .git excluded', () => {
  const entries = U.parseTar(tarArchive([
    tarEntry('pax_global_header', '52 comment=sha\n', 'g'),
    tarEntry('owner-repo-sha/', null, '5'),
    tarEntry('owner-repo-sha/index.html', '<html/>'),
    tarEntry('owner-repo-sha/main.js', 'js'),
    tarEntry('owner-repo-sha/config/secrets.local.js', 'STOLEN'),
    tarEntry('owner-repo-sha/config/runtime-config.js', 'OVERRIDE'),
    tarEntry('owner-repo-sha/update-state.json', '{}'),
    tarEntry('owner-repo-sha/.git/config', 'gitcfg'),
    tarEntry('owner-repo-sha/../escape.js', 'evil')
  ]))
  const plan = U.planUpdateFiles(entries)
  assert.deepStrictEqual(plain(plan.map(p => p.path)), ['index.html', 'main.js'])
  assert.strictEqual(Buffer.from(plan[0].data).toString('utf8'), '<html/>')
})

test('planUpdateFiles: custom protected list overrides default', () => {
  const entries = U.parseTar(tarArchive([
    tarEntry('r/a.js', 'a'),
    tarEntry('r/b.js', 'b')
  ]))
  const plan = U.planUpdateFiles(entries, ['b.js'])
  assert.deepStrictEqual(plain(plan.map(p => p.path)), ['a.js'])
})

test('planUpdateFiles: PROTECTED_PATHS covers secrets, runtime config, state', () => {
  assert.deepStrictEqual(plain(U.PROTECTED_PATHS.slice().sort()), [
    'config/runtime-config.js',
    'config/secrets.local.js',
    'update-state.json'
  ])
})

// ── shortSha ────────────────────────────────────────────────────────────────

test('shortSha: 7 chars, tolerant of bad input', () => {
  assert.strictEqual(U.shortSha('0123456789abcdef'), '0123456')
  assert.strictEqual(U.shortSha(null), '')
})
