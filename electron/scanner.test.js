// Self-check: node electron/scanner.test.js
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { scan, assertSafePath, toRegex, DEFAULT_RULES, remove } = require('./scanner')

// Fixtures live inside the repo, NOT in os.tmpdir(): on macOS that resolves to /var/folders/...,
// and the scanner correctly refuses to touch anything under /var. Blocking /var is right, so the
// test has to move rather than the guard.
const TMP_ROOT = path.join(__dirname, '..', '.tmp-tests')
fs.mkdirSync(TMP_ROOT, { recursive: true })
const mkTmp = (prefix) => fs.mkdtempSync(path.join(TMP_ROOT, prefix))

const t = (name, fn) => fn().then(() => console.log('ok -', name), (e) => { console.error('FAIL -', name, e); process.exitCode = 1 })

// --- safety guards ---
t('blocks drive root / home / system dirs', async () => {
  assert.throws(() => assertSafePath(path.parse(process.cwd()).root))
  assert.throws(() => assertSafePath(os.homedir()))
  assert.throws(() => assertSafePath(process.platform === 'win32' ? process.env.SystemRoot : '/usr'))
  assert.doesNotThrow(() => assertSafePath(process.cwd()))
})

t('glob patterns match the right names only', async () => {
  assert.ok(toRegex('*.log').test('npm-debug.log'))
  assert.ok(!toRegex('*.log').test('logger.js'))
  assert.ok(toRegex('.aider*').test('.aider.chat.history'))
  assert.ok(!toRegex('node_modules').test('my_node_modules'))
})

// --- scan on a throwaway tree ---
t('scan groups by project, sizes matches, and does not descend into them', async () => {
  const root = mkTmp('scan-')
  const mk = (p, bytes) => {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true })
    fs.writeFileSync(path.join(root, p), Buffer.alloc(bytes))
  }
  mk('proj-a/package.json', 10)
  mk('proj-a/node_modules/big.bin', 1000)
  mk('proj-a/node_modules/dist/nested.bin', 500) // must NOT be reported separately
  mk('proj-a/src/app.js', 20)
  mk('proj-a/debug.log', 7)
  mk('proj-b/dist/out.bin', 300)
  mk('skipme/dist/out.bin', 999)

  const res = await scan([root], { rules: DEFAULT_RULES, exclusions: [path.join(root, 'skipme')] })
  const names = res.projects.map((p) => p.name).sort()
  assert.deepStrictEqual(names, ['proj-a', 'proj-b'], 'excluded project must be skipped')

  const a = res.projects.find((p) => p.name === 'proj-a')
  assert.deepStrictEqual(a.items.map((i) => i.name).sort(), ['debug.log', 'node_modules'])
  assert.strictEqual(a.items.find((i) => i.name === 'node_modules').size, 1500, 'size includes nested files')
  assert.strictEqual(res.totalBytes, 1500 + 7 + 300)

  // delete guard: refuses anything outside the scanned parents
  const bad = await remove([path.join(TMP_ROOT, 'elsewhere')], { parentFolders: [root] })
  assert.strictEqual(bad.deleted.length, 0)
  assert.match(bad.failed[0].reason, /outside/)

  fs.rmSync(root, { recursive: true, force: true })
})

t('lastModified follows source files, not cleanable folders or .git', async () => {
  const root = mkTmp('scan-')
  const mk = (p, bytes, mtime) => {
    const full = path.join(root, p)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, Buffer.alloc(bytes))
    if (mtime) fs.utimesSync(full, mtime / 1000, mtime / 1000)
  }
  const old = Date.now() - 200 * 86400000
  mk('stale/package.json', 10, old)
  mk('stale/src/app.js', 20, old)
  mk('stale/node_modules/x.bin', 100) // fresh, but must not count
  mk('stale/.git/objects/deadbeef', 50) // fresh, but must not count

  const res = await scan([root], { rules: DEFAULT_RULES })
  const p = res.projects[0]
  assert.ok(Date.now() - p.lastModified > 190 * 86400000, 'project should read as stale, got ' + new Date(p.lastModified))

  fs.rmSync(root, { recursive: true, force: true })
})

t('delete streams determinate progress', async () => {
  const root = mkTmp('scan-')
  const dirs = ['a/dist', 'b/dist', 'c/dist'].map((d) => path.join(root, d))
  dirs.forEach((d) => {
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'f.bin'), Buffer.alloc(64))
  })
  const seen = []
  const res = await remove(dirs, {
    permanent: true,
    parentFolders: [root],
    onProgress: (p) => seen.push(p)
  })
  assert.strictEqual(res.deleted.length, 3)
  assert.strictEqual(res.freed, 192)
  assert.deepStrictEqual(seen.map((s) => s.done), [0, 1, 2, 3], 'one tick per item plus a final one')
  assert.ok(seen.every((s) => s.total === 3))
  assert.ok(dirs.every((d) => !fs.existsSync(d)))

  fs.rmSync(root, { recursive: true, force: true })
})
