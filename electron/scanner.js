const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

// ---------- default cleanup rules ----------
// kind: 'folder' matches directory names, 'file' matches file names. '*' is the only wildcard.
const DEFAULT_RULES = [
  ['Dependencies', true, 'folder', ['node_modules']],
  ['Build outputs', true, 'folder', ['dist', 'build', '.next', '.nuxt', 'out', '.svelte-kit']],
  ['Caches', true, 'folder', ['.cache', '.turbo', '.parcel-cache', '.vite', '__pycache__', '.pytest_cache']],
  ['Caches', true, 'file', ['.eslintcache']],
  ['AI tool artifacts', false, 'folder', ['.aider*', '.cursor-cache', '.continue', '.codeium', '.copilot-cache']],
  ['Logs & temp files', true, 'folder', ['tmp', '.tmp']],
  ['Logs & temp files', true, 'file', ['*.log', 'npm-debug.log*']],
  ['OS junk', true, 'file', ['.DS_Store', 'Thumbs.db']]
].flatMap(([category, safe, kind, patterns]) =>
  patterns.map((pattern) => ({
    id: kind + ':' + pattern,
    category,
    safe,
    kind,
    pattern,
    enabled: safe // "review carefully" categories ship disabled
  }))
)

const CATEGORY_NOTES = {
  Dependencies: 'Safe to remove - regenerates with npm/yarn/pnpm install.',
  'Build outputs': 'Safe to remove - regenerates on your next build.',
  Caches: 'Safe to remove - rebuilt automatically.',
  'AI tool artifacts': 'Review carefully - some AI-tool folders also hold local settings or chat history.',
  'Logs & temp files': 'Safe to remove.',
  'OS junk': 'Safe to remove.'
}

// Never worth walking: huge, never cleanable, and it would skew "last edited" for a project.
const SKIP_DIRS = new Set(['.git', '.hg', '.svn'])

// Fixed, app-authored safety wording. The AI never writes these — they must always be correct.
const SAFETY_LINES = {
  Dependencies:
    "Installed dependencies. Safe to delete — restore anytime by running the project's install command (e.g. npm install).",
  'Build outputs': "Build output. Safe to delete — it's regenerated the next time you build the project.",
  Caches: 'Cache files. Safe to delete — they rebuild automatically.',
  'Logs & temp files': 'Logs and temporary files. Safe to delete.',
  'AI tool artifacts': 'May contain local tool settings — review before deleting.',
  'OS junk': 'Operating-system junk files. Safe to delete.'
}

const toRegex = (pattern) =>
  new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i')

// ---------- safety ----------
const WIN_BLOCKED = [
  process.env.SystemRoot,
  process.env.ProgramFiles,
  process.env['ProgramFiles(x86)'],
  process.env.ProgramData
]
const POSIX_BLOCKED = ['/usr', '/bin', '/sbin', '/etc', '/var', '/lib', '/opt', '/System', '/Library', '/Applications', '/private']
const BLOCKED = (process.platform === 'win32' ? WIN_BLOCKED : POSIX_BLOCKED)
  .filter(Boolean)
  .map((p) => path.resolve(p))

const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))
const isInside = (child, parent) => {
  const rel = path.relative(norm(parent), norm(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Throws with a human-readable reason if this path must never be scanned or deleted. */
function assertSafePath(target) {
  const p = path.resolve(target)
  if (p === path.parse(p).root) throw new Error('"' + p + '" is a drive root. Pick a project folder instead.')
  if (norm(p) === norm(os.homedir()))
    throw new Error('"' + p + '" is your home folder root. Pick a subfolder instead.')
  for (const b of BLOCKED) {
    // block the system folder itself, anything inside it, and any folder that contains it
    if (isInside(p, b) || isInside(b, p))
      throw new Error('"' + p + '" is or contains a protected system folder (' + b + ').')
  }
  return p
}

// ---------- sizing ----------
/** Sum of file sizes under dir. Never follows symlinks. Unreadable entries are skipped. */
async function dirSize(dir, onError) {
  let total = 0
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    onError && onError(dir, err)
    return 0
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) total += await dirSize(full, onError)
    else if (e.isFile()) {
      try {
        total += (await fs.lstat(full)).size
      } catch (err) {
        onError && onError(full, err)
      }
    }
  }
  return total
}

// ---------- scan ----------
const isProjectRoot = async (dir) => {
  for (const marker of ['package.json', '.git']) {
    try {
      await fs.access(path.join(dir, marker))
      return true
    } catch {}
  }
  return false
}

/**
 * Walks parentFolders and returns cleanable items grouped by project.
 * opts: { rules, exclusions, onProgress, shouldCancel }
 */
async function scan(parentFolders, opts = {}) {
  const rules = (opts.rules || DEFAULT_RULES)
    .filter((r) => r.enabled)
    .map((r) => ({ ...r, re: toRegex(r.pattern) }))
  const exclusions = (opts.exclusions || []).map(norm)
  const skipped = []
  const onError = (p, err) => {
    skipped.push({ path: p, reason: err.code || err.message })
  }
  const excluded = (p) => exclusions.some((x) => isInside(p, x))
  const cancelled = () => opts.shouldCancel && opts.shouldCancel() === true
  const progress = (current) => opts.onProgress && opts.onProgress({ found, totalBytes, current })

  const projects = []
  let found = 0
  let totalBytes = 0

  for (const parent of parentFolders) {
    const root = assertSafePath(parent)
    let roots
    if (await isProjectRoot(root)) roots = [root]
    else {
      // ponytail: projects are one level deep. Nested workspace-of-workspaces would need recursion; add if it bites.
      const entries = await fs.readdir(root, { withFileTypes: true }).catch((e) => {
        onError(root, e)
        return []
      })
      roots = entries
        .filter((e) => e.isDirectory() && !e.isSymbolicLink())
        .map((e) => path.join(root, e.name))
    }

    for (const projectPath of roots) {
      if (cancelled()) return { projects, skipped, totalBytes, cancelled: true }
      if (excluded(projectPath)) continue
      const items = []
      let lastModified = 0 // newest mtime of real source files, cleanable folders excluded
      let otherBytes = 0 // everything that is NOT a cleanable item, so we can total the project

      const walk = async (dir) => {
        if (cancelled()) return
        let entries
        try {
          entries = await fs.readdir(dir, { withFileTypes: true })
        } catch (err) {
          return onError(dir, err)
        }
        for (const e of entries) {
          if (cancelled()) return
          if (e.isSymbolicLink()) continue
          const full = path.join(dir, e.name)
          if (excluded(full)) continue
          const kind = e.isDirectory() ? 'folder' : e.isFile() ? 'file' : null
          if (!kind) continue
          const rule = rules.find((r) => r.kind === kind && r.re.test(e.name))
          if (rule) {
            // never offer a scan root or a project root itself for deletion
            if (
              norm(full) === norm(projectPath) ||
              parentFolders.some((p) => norm(full) === norm(p))
            )
              continue
            let size = 0
            if (kind === 'folder') size = await dirSize(full, onError)
            else {
              try {
                size = (await fs.lstat(full)).size
              } catch (err) {
                onError(full, err)
              }
            }
            items.push({
              path: full,
              name: e.name,
              kind,
              category: rule.category,
              safe: rule.safe,
              size
            })
            found++
            totalBytes += size
            progress(full)
            continue // matched folders are recorded, never walked into
          }
          if (kind === 'folder') {
            if (SKIP_DIRS.has(e.name)) {
              // not walked for rules or mtime, but its bytes still belong to the project total
              otherBytes += await dirSize(full, onError)
            } else await walk(full)
          } else {
            try {
              const st = await fs.lstat(full)
              otherBytes += st.size
              if (st.mtimeMs > lastModified) lastModified = st.mtimeMs
            } catch {} // an unreadable file just doesn't count toward "last edited"
          }
        }
      }

      await walk(projectPath)
      projects.push({
        name: path.basename(projectPath),
        path: projectPath,
        items,
        lastModified,
        // total size of the whole project folder, cleanable items included
        totalBytes: otherBytes + items.reduce((sum, i) => sum + i.size, 0)
      })
      progress(projectPath)
    }
  }
  return { projects, skipped, totalBytes, cancelled: cancelled() }
}

// ---------- delete ----------
let trashFn
async function sendToTrash(target, log = () => {}) {
  if (!trashFn) {
    try {
      trashFn = (await import('trash')).default
    } catch (err) {
      log('trash-import-failed', err.message)
      trashFn = null
    }
  }
  // Two independent implementations of the same idea: the `trash` package shells out to a bundled
  // windows-trash.exe, Electron's shell.trashItem calls IFileOperation in-process. They fail in
  // different situations, so a failure from one is worth retrying with the other before giving up.
  const attempts = []
  if (trashFn) attempts.push(['trash-package', trashFn])
  attempts.push(['shell.trashItem', (p) => require('electron').shell.trashItem(p)])

  let lastErr
  for (const [name, fn] of attempts) {
    try {
      await fn(target)
      return
    } catch (err) {
      lastErr = err
      log('trash-backend-failed', name, err.message)
    }
  }
  throw lastErr
}

/**
 * Turns a backend error into something a person can act on.
 *
 * Both trash backends report a blocked move uselessly — the `trash` package gives
 * "Command failed: windows-trash.exe <path>" with empty stderr, and shell.trashItem gives
 * "Operation was aborted". Neither names a cause, so we say what is actually true and what to do.
 */
function describeFailure(err) {
  const raw = String((err && err.message) || err).replace(/\s+/g, ' ').trim()
  if (
    /Command failed|Operation was aborted|Failed to perform delete|EBUSY|EPERM|resource busy|being used by another/i.test(
      raw
    )
  )
    return (
      'Windows would not move this to the Recycle Bin. Something is almost certainly holding a file ' +
      'inside it open — a running dev server, a terminal sitting in the folder, or your editor ' +
      'indexing it. Close those and try again.'
    )
  if (/EACCES|access is denied|permission/i.test(raw))
    return 'Permission denied. Try running DevBroom as the same user that created these files.'
  if (/ENAMETOOLONG/i.test(raw)) return 'The path is too long for this operation.'
  return raw || 'unknown error'
}

/**
 * Cheap, reliable checks only.
 *
 * A tempting idea is to walk the folder and find the locked file by opening each one — that does
 * NOT work: Node opens with permissive Windows share modes, so the probe succeeds even while the
 * handle that blocks the move is held. Rather than print a confident wrong answer, we only report
 * what we can actually prove here and let describeFailure() explain the rest.
 */
async function diagnose(target) {
  try {
    await fs.lstat(target)
  } catch (err) {
    if (err.code === 'ENOENT') return 'already gone'
    return `cannot read it (${err.code})`
  }
  try {
    await fs.readdir(target)
  } catch (err) {
    if (err.code === 'ENOTDIR') return null // a plain file, nothing more to check
    if (err.code === 'EACCES' || err.code === 'EPERM')
      return `permission denied reading the folder (${err.code})`
  }
  return null
}

/**
 * Moves paths to Trash (or permanently deletes when permanent === true).
 *
 * Every input path lands in exactly one bucket — deleted / failed / skipped — and "deleted" is only
 * recorded after the item is verified gone. shouldCancel() is checked between items, so Stop
 * finishes the item in flight and skips the rest.
 * onProgress({ done, total, current }); onItem({ path, status, reason, size }).
 */
async function remove(paths, opts = {}) {
  const {
    permanent = false,
    parentFolders = [],
    protectedPaths = [],
    onProgress,
    onItem,
    shouldCancel,
    log = () => {}
  } = opts
  const results = { freed: 0, deleted: [], failed: [], skipped: [], cancelled: false }
  const targets = []

  // ---- validation pass: anything rejected here is a real failure the user must see ----
  for (const p of paths) {
    try {
      const full = assertSafePath(p)
      if (parentFolders.some((pf) => norm(pf) === norm(full)))
        throw new Error('refusing to delete a scanned parent folder')
      if (parentFolders.length && !parentFolders.some((pf) => isInside(full, pf)))
        throw new Error('outside every scanned folder')
      if (protectedPaths.some((pp) => isInside(full, pp))) throw new Error('project is protected')
      const st = await fs.lstat(full)
      if (st.isSymbolicLink()) throw new Error('symbolic link, skipped')
      const size = st.isDirectory() ? await dirSize(full) : st.size
      targets.push({ full, size })
    } catch (err) {
      const reason = err.code === 'ENOENT' ? 'already gone' : err.message
      log('validate-failed', p, reason)
      const bucket = reason === 'already gone' ? results.skipped : results.failed
      bucket.push({ path: p, reason })
      onItem && onItem({ path: p, status: bucket === results.skipped ? 'skipped' : 'failed', reason })
    }
  }

  // ---- delete pass ----
  for (const [i, t] of targets.entries()) {
    if (shouldCancel && shouldCancel()) {
      // Stop was pressed: everything not yet started stays on the dashboard, untouched.
      results.cancelled = true
      for (const rest of targets.slice(i)) {
        results.skipped.push({ path: rest.full, reason: 'stopped before this item' })
        onItem && onItem({ path: rest.full, status: 'skipped', reason: 'stopped before this item' })
      }
      break
    }

    onProgress && onProgress({ done: i, total: targets.length, current: t.full })
    try {
      log('deleting', t.full)
      if (permanent) await fs.rm(t.full, { recursive: true, force: true, maxRetries: 2, retryDelay: 120 })
      else await sendToTrash(t.full, log)

      // never report success on the backend's word alone — check it is actually gone
      let stillThere = true
      try {
        await fs.lstat(t.full)
      } catch {
        stillThere = false
      }
      if (stillThere) throw new Error('the delete call returned without an error but the item is still on disk')

      results.freed += t.size
      results.deleted.push({ path: t.full, size: t.size })
      onItem && onItem({ path: t.full, status: 'deleted', size: t.size })
      log('deleted', t.full, t.size)
    } catch (err) {
      const detail = await diagnose(t.full).catch(() => null)
      if (detail === 'already gone') {
        // something else removed it; that is a success from the user's point of view
        results.freed += t.size
        results.deleted.push({ path: t.full, size: t.size })
        onItem && onItem({ path: t.full, status: 'deleted', size: t.size })
      } else {
        const reason = detail || describeFailure(err)
        log('FAILED', t.full, reason, err)
        results.failed.push({ path: t.full, reason })
        onItem && onItem({ path: t.full, status: 'failed', reason })
      }
    }
  }

  onProgress && onProgress({ done: targets.length, total: targets.length, current: '' })
  return results
}

module.exports = {
  DEFAULT_RULES,
  diagnose,
  CATEGORY_NOTES,
  SAFETY_LINES,
  assertSafePath,
  scan,
  remove,
  dirSize,
  isInside,
  toRegex
}
