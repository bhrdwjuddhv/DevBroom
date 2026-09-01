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

t('every project is returned with a full folder size, and protected projects are refused', async () => {
  const root = mkTmp('scan-')
  const mk = (p, bytes) => {
    const full = path.join(root, p)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, Buffer.alloc(bytes))
  }
  mk('with-junk/package.json', 10)
  mk('with-junk/src/app.js', 90)
  mk('with-junk/node_modules/big.bin', 400)
  mk('with-junk/.git/objects/abc', 50)
  mk('clean/package.json', 10)
  mk('clean/src/only-source.js', 25)

  const res = await scan([root], { rules: DEFAULT_RULES })
  const names = res.projects.map((p) => p.name).sort()
  // Projects mode needs projects that have nothing cleanable in them too
  assert.deepStrictEqual(names, ['clean', 'with-junk'])

  const junk = res.projects.find((p) => p.name === 'with-junk')
  // whole-folder size: source + .git + the cleanable folder
  assert.strictEqual(junk.totalBytes, 10 + 90 + 50 + 400)
  assert.strictEqual(res.projects.find((p) => p.name === 'clean').totalBytes, 35)
  // the scan total still counts only what is recoverable
  assert.strictEqual(res.totalBytes, 400)

  // a protected project cannot be deleted even if the UI asks for it
  const blocked = await remove([junk.path], {
    permanent: true,
    parentFolders: [root],
    protectedPaths: [junk.path]
  })
  assert.strictEqual(blocked.deleted.length, 0)
  assert.match(blocked.failed[0].reason, /protected/)
  assert.ok(fs.existsSync(junk.path), 'protected project must still exist')

  // and a file inside a protected project is refused too, not just the folder itself
  const inside = await remove([path.join(junk.path, 'node_modules')], {
    permanent: true,
    parentFolders: [root],
    protectedPaths: [junk.path]
  })
  assert.strictEqual(inside.deleted.length, 0)
  assert.match(inside.failed[0].reason, /protected/)

  fs.rmSync(root, { recursive: true, force: true })
})

t('every path lands in exactly one bucket, and Stop leaves the rest untouched', async () => {
  const root = mkTmp('scan-')
  const mk = (rel) => {
    const p = path.join(root, rel)
    fs.mkdirSync(p, { recursive: true })
    fs.writeFileSync(path.join(p, 'f.bin'), Buffer.alloc(64))
    return p
  }
  const a = mk('p1/dist')
  const b = mk('p2/dist')
  const c = mk('p3/dist')
  const missing = path.join(root, 'p4', 'dist') // never created
  const outside = path.join(TMP_ROOT, 'not-in-scope')

  const events = []
  const res = await remove([a, missing, outside, b, c], {
    permanent: true,
    parentFolders: [root],
    onItem: (i) => events.push(i)
  })

  // one event per input path, no duplicates, no silent drops
  assert.strictEqual(events.length, 5)
  const total = res.deleted.length + res.failed.length + res.skipped.length
  assert.strictEqual(total, 5, 'every input must be accounted for exactly once')
  assert.strictEqual(res.deleted.length, 3)
  assert.deepStrictEqual(res.skipped.map((s) => s.reason), ['already gone'])
  assert.match(res.failed[0].reason, /outside/)
  assert.strictEqual(res.freed, 192)

  // "deleted" is only ever reported for something actually gone
  for (const d of res.deleted) assert.ok(!fs.existsSync(d.path), d.path + ' reported deleted but exists')

  // --- Stop: the item in flight finishes, nothing after it is touched ---
  const d1 = mk('q1/dist')
  const d2 = mk('q2/dist')
  const d3 = mk('q3/dist')
  let calls = 0
  const stopped = await remove([d1, d2, d3], {
    permanent: true,
    parentFolders: [root],
    shouldCancel: () => calls++ >= 1 // allow the first, stop before the rest
  })
  assert.ok(stopped.cancelled)
  assert.strictEqual(stopped.deleted.length, 1)
  assert.strictEqual(stopped.skipped.length, 2)
  assert.ok(stopped.skipped.every((s) => /stopped/.test(s.reason)))
  assert.ok(fs.existsSync(d2) && fs.existsSync(d3), 'skipped items must still be on disk')

  fs.rmSync(root, { recursive: true, force: true })
})
