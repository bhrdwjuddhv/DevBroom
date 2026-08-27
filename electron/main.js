const fs = require('node:fs/promises')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron')
const { DEFAULT_RULES, CATEGORY_NOTES, assertSafePath, scan, remove } = require('./scanner')
const ai = require('./ai')

const DEV_URL = process.env.VITE_DEV_URL
const ICON = path.join(__dirname, '..', 'src', 'public', 'icon.png')
let store
let win
let cancelScan = false

const defaults = {
  parentFolders: [],
  exclusions: [],
  rules: DEFAULT_RULES,
  permanentDelete: false,
  theme: { mode: 'dark', accent: 'crimson' },
  oldOnly: false,
  oldDays: 30,
  weeklyReminder: false,
  lastScan: null,
  aiModel: null,
  reports: []
}

function readSettings() {
  const s = { ...defaults, ...store.store }
  // keep saved on/off choices, but pick up rules added in newer versions
  const saved = new Map((s.rules || []).map((r) => [r.id, r]))
  s.rules = [
    ...DEFAULT_RULES.map((r) => ({ ...r, enabled: saved.has(r.id) ? saved.get(r.id).enabled : r.enabled })),
    ...(s.rules || []).filter((r) => r.custom)
  ]
  // a saved model id can outlive the model list across upgrades — don't leave a dangling selection
  if (s.aiModel && !ai.MODELS.some((m) => m.id === s.aiModel)) s.aiModel = null
  return s
}

// Read once from package.json so the About box can never drift from what was shipped.
const pkg = require('../package.json')
const ABOUT = {
  name: 'DevBroom',
  version: pkg.version,
  description: pkg.description,
  homepage: pkg.homepage,
  license: pkg.license,
  author: pkg.author,
  electron: process.versions.electron,
  node: process.versions.node
}

// Everything the renderer receives, minus the report log (fetched separately, it can get long).
const publicSettings = () => {
  const { reports, ...rest } = readSettings()
  return { ...rest, categoryNotes: CATEGORY_NOTES, models: ai.list(), about: ABOUT }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    backgroundColor: '#000000',
    title: 'DevBroom',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (DEV_URL) {
    // surface renderer/preload problems in the terminal running `npm run dev`
    win.webContents.on('console-message', (e) => console.log('[renderer]', e.message))
    win.webContents.on('preload-error', (_e, file, err) => console.error('[preload]', file, err))
    win.loadURL(DEV_URL)
  } else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(async () => {
  const Store = (await import('electron-store')).default
  store = new Store({ defaults })
  ai.setModelsDir(path.join(app.getPath('userData'), 'models'))
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
app.on('before-quit', () => ai.unload())

// ---------- settings ----------
ipcMain.handle('settings:get', () => publicSettings())

ipcMain.handle('settings:set', (_e, patch) => {
  store.set({ ...readSettings(), ...patch })
  return publicSettings()
})

ipcMain.handle('folders:add', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'multiSelections'],
    title: 'Choose a folder where your projects live'
  })
  if (canceled) return { ok: true, settings: publicSettings() }
  const s = readSettings()
  const errors = []
  for (const p of filePaths) {
    try {
      const safe = assertSafePath(p)
      if (!s.parentFolders.includes(safe)) s.parentFolders.push(safe)
    } catch (err) {
      errors.push(err.message)
    }
  }
  store.set('parentFolders', s.parentFolders)
  return { ok: errors.length === 0, error: errors.join('\n'), settings: publicSettings() }
})

ipcMain.handle('folders:pickExclusion', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Choose a folder to always skip'
  })
  if (canceled) return publicSettings()
  const s = readSettings()
  if (!s.exclusions.includes(filePaths[0])) s.exclusions.push(filePaths[0])
  store.set('exclusions', s.exclusions)
  return publicSettings()
})

// ---------- scan ----------
ipcMain.handle('scan:start', async (e) => {
  const s = readSettings()
  if (!s.parentFolders.length) return { error: 'Add at least one folder to scan.' }
  cancelScan = false
  let last = 0
  try {
    const res = await scan(s.parentFolders, {
      rules: s.rules,
      exclusions: s.exclusions,
      shouldCancel: () => cancelScan,
      onProgress: (p) => {
        const now = Date.now()
        if (now - last < 80) return // ponytail: throttle so IPC doesn't drown the renderer
        last = now
        e.sender.send('scan:progress', p)
      }
    })
    if (!res.cancelled) store.set('lastScan', Date.now())
    return res
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle('scan:cancel', () => {
  cancelScan = true
})

// ---------- delete ----------
ipcMain.handle('items:delete', async (e, items) => {
  const s = readSettings()
  const paths = items.map((i) => i.path)
  const before = await freeSpaceFor(paths[0] ?? s.parentFolders[0])

  const res = await remove(paths, {
    permanent: s.permanentDelete,
    parentFolders: s.parentFolders,
    onProgress: (p) => e.sender.send('delete:progress', p)
  })

  const after = await freeSpaceFor(paths[0] ?? s.parentFolders[0])
  const byPath = new Map(items.map((i) => [i.path, i]))
  const deleted = res.deleted.map((d) => ({ ...byPath.get(d.path), ...d }))

  const report = {
    id: String(Date.now()),
    at: Date.now(),
    destination: s.permanentDelete ? 'Permanently deleted' : 'Recycle Bin / Trash',
    freed: res.freed,
    items: deleted.map((d) => ({
      path: d.path,
      name: d.name,
      size: d.size,
      category: d.category ?? 'Unknown',
      project: d.project ?? path.dirname(d.path)
    })),
    failed: res.failed,
    diskBefore: before,
    diskAfter: after
  }
  store.set('reports', [report, ...readSettings().reports].slice(0, 200))
  return { ...res, report }
})

// ---------- disk ----------
async function freeSpaceFor(target) {
  // ponytail: fs.statfs has been in Node since 18 — check-disk-space would just wrap this.
  if (!target) return null
  try {
    const st = await fs.statfs(target)
    return {
      drive: process.platform === 'win32' ? path.parse(path.resolve(target)).root : '/',
      free: st.bavail * st.bsize,
      total: st.blocks * st.bsize
    }
  } catch {
    return null
  }
}
ipcMain.handle('disk:free', (_e, target) => freeSpaceFor(target ?? readSettings().parentFolders[0]))

// ---------- reports ----------
ipcMain.handle('reports:list', () => readSettings().reports)
ipcMain.handle('reports:delete', (_e, id) => {
  const kept = readSettings().reports.filter((r) => r.id !== id)
  store.set('reports', kept)
  return kept
})
ipcMain.handle('reports:clear', () => {
  store.set('reports', [])
  return []
})

// ---------- ai ----------
ipcMain.handle('ai:list', () => ai.list())
ipcMain.handle('ai:download', async (e, id) => {
  try {
    await ai.download(id, (p) => e.sender.send('ai:download-progress', { id, ...p }))
    if (!readSettings().aiModel) store.set('aiModel', id)
    return { ok: true, models: ai.list() }
  } catch (err) {
    return { ok: false, error: err.message, models: ai.list() }
  }
})
ipcMain.handle('ai:cancelDownload', () => ai.cancelDownload())
ipcMain.handle('ai:remove', async (_e, id) => {
  await ai.remove(id)
  if (readSettings().aiModel === id) store.set('aiModel', null)
  return ai.list()
})
// Facts come straight from the project's files — no model needed, so the panel can show them instantly.
ipcMain.handle('ai:facts', (_e, { projectPath, item }) => ai.facts(projectPath, item))

ipcMain.handle('ai:explain', async (e, payload) => {
  const modelId = readSettings().aiModel
  if (!modelId)
    return { error: 'No local model selected. Download one in Settings → Project AI Helper.' }
  try {
    const { facts, summary } = await ai.explain({ ...payload, modelId }, (chunk) =>
      e.sender.send('ai:token', { key: payload.key, chunk })
    )
    return { facts, summary }
  } catch (err) {
    return { error: err.message }
  }
})

// ---------- misc ----------
ipcMain.handle('notify', (_e, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body, icon: ICON }).show()
})
ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p))
ipcMain.handle('shell:open', (_e, url) => {
  // only ever hand the OS a real web link, never an arbitrary path or scheme
  if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
})
