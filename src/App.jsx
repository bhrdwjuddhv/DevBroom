import { useEffect, useMemo, useRef, useState } from 'react'
import Settings from './Settings.jsx'
import Reports from './Reports.jsx'
import Charts from './Charts.jsx'
import { applyTheme } from './theme.js'
import { DAY, ago, formatBytes } from './format.js'
import icon from './public/icon.png'

const api = window.devbroom
const RECENT_DAYS = 7
const WEEK = 7 * DAY

/** Checkbox that can also render the half-checked state, which React can't express declaratively. */
function TriCheckbox({ checked, indeterminate, ...rest }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate) && !checked
  }, [indeterminate, checked])
  return <input ref={ref} type="checkbox" checked={checked} {...rest} />
}

export default function App() {
  const [settings, setSettings] = useState(null)
  const [view, setView] = useState('scan')
  const [mode, setMode] = useState('redundant') // 'redundant' | 'projects'
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('size')
  const [confirming, setConfirming] = useState(false)
  const [ack, setAck] = useState({ permanent: false, recent: false, projects: false })
  const [deleting, setDeleting] = useState(null)
  const [disk, setDisk] = useState(null)
  const [diskGain, setDiskGain] = useState(null)
  const [toast, setToast] = useState(null)
  const [ai, setAi] = useState(null)
  const [remind, setRemind] = useState(false)

  useEffect(() => {
    ;(async () => {
      const s = await api.getSettings()
      setSettings(s)
      applyTheme(s.theme)
      if (s.weeklyReminder && (!s.lastScan || Date.now() - s.lastScan > WEEK)) {
        setRemind(true)
        api.notify('DevBroom', "It's been a week since your last scan.")
      }

      // show the previous scan instead of rescanning; only scan unprompted the very first time
      const cached = await api.lastScan()
      if (cached?.projects) setResult(cached)
      else if (s.parentFolders.length) doScan()

      // a delete started before this window reloaded is still running in the main process
      const running = await api.deleteStatus()
      if (running) {
        setDeleting(running)
        setConfirming(true)
      }
    })()

    const offScan = api.onScanProgress(setProgress)
    const offDel = api.onDeleteProgress((p) => setDeleting(p))
    const offTok = api.onAiToken(({ key, chunk }) =>
      setAi((a) => (a && a.key === key ? { ...a, text: a.text + chunk } : a))
    )
    return () => {
      offScan()
      offDel()
      offTok()
    }
  }, [])

  // the meter needs a path on the drive, so re-read it whenever the first scan folder changes
  const firstFolder = settings?.parentFolders?.[0]
  useEffect(() => {
    if (firstFolder) api.diskFree(firstFolder).then(setDisk)
  }, [firstFolder])

  const update = (s) => {
    setSettings(s)
    applyTheme(s.theme)
  }
  const save = async (patch) => update(await api.setSettings(patch))

  const projects = result?.projects ?? []
  const isProtected = (p) => (settings?.protectedProjects ?? []).includes(p.path)

  // one scan feeds both modes; each mode just filters the same project list differently
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const cutoff = Date.now() - (settings?.oldDays ?? 30) * DAY
    let list = projects
    if (mode === 'redundant') list = list.filter((p) => p.items.length)
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q))
    if (settings?.oldOnly) list = list.filter((p) => (p.lastModified || 0) < cutoff)
    const size = (p) => (mode === 'projects' ? p.totalBytes : p.items.reduce((s, i) => s + i.size, 0))
    return [...list].sort((a, b) => (sort === 'size' ? size(b) - size(a) : a.name.localeCompare(b.name)))
  }, [projects, mode, search, sort, settings?.oldOnly, settings?.oldDays])

  const projectSize = (p) => (mode === 'projects' ? p.totalBytes : p.items.reduce((s, i) => s + i.size, 0))
  const allItems = useMemo(() => visible.flatMap((p) => p.items), [visible])
  const visibleBytes = visible.reduce((s, p) => s + projectSize(p), 0)

  // what a checkbox actually toggles differs per mode: individual items vs whole project folders
  const selectablePaths = useMemo(
    () =>
      visible
        .filter((p) => !isProtected(p))
        .flatMap((p) => (mode === 'projects' ? [p.path] : p.items.map((i) => i.path))),
    [visible, mode, settings?.protectedProjects]
  )

  const selectedItems = useMemo(() => {
    if (mode === 'projects')
      return visible
        .filter((p) => selected.has(p.path) && !isProtected(p))
        .map((p) => ({
          path: p.path,
          name: p.name,
          size: p.totalBytes,
          category: 'Whole project',
          project: p.name,
          kind: 'project'
        }))
    return visible
      .filter((p) => !isProtected(p))
      .flatMap((p) =>
        p.items.filter((i) => selected.has(i.path)).map((i) => ({ ...i, project: p.name, kind: 'item' }))
      )
  }, [visible, selected, mode, settings?.protectedProjects])

  const selectedBytes = selectedItems.reduce((s, i) => s + i.size, 0)

  const chartProjects = useMemo(() => {
    const withItems = visible.filter((p) => p.items.length)
    if (!selected.size || mode === 'projects') return withItems
    return withItems
      .map((p) => ({ ...p, items: p.items.filter((i) => selected.has(i.path)) }))
      .filter((p) => p.items.length)
  }, [visible, selected, mode])

  const byCategory = useMemo(() => {
    const m = new Map()
    for (const i of allItems) {
      const c = m.get(i.category) ?? { count: 0, size: 0 }
      m.set(i.category, { count: c.count + 1, size: c.size + i.size })
    }
    return [...m.entries()].sort((a, b) => b[1].size - a[1].size)
  }, [allItems])

  const setSel = (paths, on) =>
    setSelected((prev) => {
      const next = new Set(prev)
      paths.forEach((p) => (on ? next.add(p) : next.delete(p)))
      return next
    })
  const allSelected = (paths) => paths.length > 0 && paths.every((p) => selected.has(p))
  const someSelected = (paths) => paths.some((p) => selected.has(p))
  const isRecent = (p) => p.lastModified && Date.now() - p.lastModified < RECENT_DAYS * DAY
  const touchesRecent = visible.some(
    (p) => isRecent(p) && (mode === 'projects' ? selected.has(p.path) : p.items.some((i) => selected.has(i.path)))
  )
  const allCollapsed = visible.length > 0 && visible.every((p) => collapsed.has(p.path))

  async function doScan() {
    setView('scan')
    setRemind(false)
    setScanning(true)
    setProgress(null)
    setSelected(new Set())
    setToast(null)
    setDiskGain(null)
    const res = await api.scan()
    setScanning(false)
    if (res.error) return setToast({ kind: 'error', text: res.error })
    setResult(res)
    setSettings((s) => ({ ...s, lastScan: res.at ?? Date.now() }))
    api.diskFree().then(setDisk)
    if (!res.projects.length) setToast({ kind: 'info', text: 'Nothing found in those folders.' })
  }

  function openConfirm() {
    setAck({ permanent: false, recent: false, projects: false })
    setDeleting(null) // never open on top of a previous run's numbers
    setConfirming(true)
  }

  async function doDelete() {
    setDeleting({ done: 0, total: selectedItems.length, current: '' })
    const res = await api.deleteItems(selectedItems)
    setDeleting(null)
    setConfirming(false)
    setAck({ permanent: false, recent: false, projects: false })
    if (res.error) return setToast({ kind: 'error', text: res.error })
    const failed = res.failed.length ? ` ${res.failed.length} item(s) could not be removed.` : ''
    setToast({
      kind: res.failed.length ? 'error' : 'ok',
      text: `Removed ${res.deleted.length} item(s) — freed ${formatBytes(res.freed)} to ${res.report.destination}.${failed}`,
      detail: res.failed.map((f) => `${f.path} — ${f.reason}`)
    })
    if (res.report.diskBefore && res.report.diskAfter) {
      setDisk(res.report.diskAfter)
      setDiskGain({ before: res.report.diskBefore, after: res.report.diskAfter })
    }
    await doScan()
  }

  async function toggleProtected(p) {
    const list = settings.protectedProjects ?? []
    const next = list.includes(p.path) ? list.filter((x) => x !== p.path) : [...list, p.path]
    if (!list.includes(p.path)) setSel([p.path, ...p.items.map((i) => i.path)], false)
    await save({ protectedProjects: next })
  }

  async function askAi(key, projectPath, item) {
    setAi({ key, text: '', loading: true, error: null, facts: null })
    api.aiFacts({ projectPath, item }).then((facts) =>
      setAi((a) => (a && a.key === key ? { ...a, facts } : a))
    )
    const res = await api.aiExplain({ key, projectPath, item })
    setAi((a) =>
      a && a.key === key
        ? { ...a, loading: false, error: res.error, facts: res.facts ?? a.facts, text: res.summary ?? a.text }
        : a
    )
  }

  if (!settings) return <div className="boot">Loading…</div>

  const AiButton = ({ id, projectPath, item }) => (
    <button
      className="tiny"
      onClick={() => (ai?.key === id ? setAi(null) : askAi(id, projectPath, item))}
      title="Explain this with the local AI model"
    >
      What is this?
    </button>
  )

  const AiPanel = ({ id }) =>
    ai?.key === id && (
      <div className="aipanel">
        <header>
          <span>What is this?</span>
          <span className="spacer" />
          <button className="x" onClick={() => setAi(null)}>
            ×
          </button>
        </header>
        {ai.facts && (
          <dl className="facts">
            <dt>Detected tech</dt>
            <dd>{ai.facts.tech.length ? ai.facts.tech.join(', ') : ai.facts.type}</dd>
            {ai.facts.safety && (
              <>
                <dt>{ai.facts.itemName}</dt>
                <dd>{ai.facts.safety}</dd>
              </>
            )}
          </dl>
        )}
        <dl className="facts">
          <dt>Summary</dt>
          <dd>
            {ai.error ? (
              <span className="muted">{ai.error}</span>
            ) : (
              <span className={ai.loading ? 'blink' : ''}>{ai.text || 'Reading the project…'}</span>
            )}
          </dd>
        </dl>
      </div>
    )

  const pct = deleting ? Math.round((deleting.done / Math.max(deleting.total, 1)) * 100) : 0

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={icon} alt="" />
          DevBroom
        </div>
        <div className="totals">
          <div className="total-num">{formatBytes(visibleBytes)}</div>
          <div className="total-label">
            {mode === 'projects' ? 'total size of listed projects' : 'total space you can recover'}
          </div>
        </div>
        {disk && (
          <div className={`disk ${diskGain ? 'flash' : ''}`}>
            <div>{disk.drive}</div>
            {diskGain ? (
              <div>
                <span className="muted">{formatBytes(diskGain.before.free)}</span> →{' '}
                <span className="gain">{formatBytes(diskGain.after.free)} free</span>
              </div>
            ) : (
              <div>
                <span className="free">{formatBytes(disk.free)}</span> free
              </div>
            )}
          </div>
        )}
        <div className="spacer" />
        {view === 'scan' && (
          <>
            <div className="selinfo">
              {selected.size} selected · <strong>{formatBytes(selectedBytes)}</strong>
            </div>
            <button className="danger" disabled={!selectedItems.length || scanning} onClick={openConfirm}>
              Delete selected
            </button>
          </>
        )}
        <div className="tabs">
          {[
            ['scan', 'Results'],
            ['reports', 'Reports'],
            ['settings', 'Settings']
          ].map(([id, label]) => (
            <button key={id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          <h3>Folders to scan</h3>
          {settings.parentFolders.length === 0 && (
            <p className="muted">No folders yet. Add the folder where your projects live.</p>
          )}
          <ul className="folders">
            {settings.parentFolders.map((f) => (
              <li key={f} title={f}>
                <span className="path">{f}</span>
                <button
                  className="x"
                  title="Remove"
                  onClick={() => save({ parentFolders: settings.parentFolders.filter((x) => x !== f) })}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button
            className="wide"
            onClick={async () => {
              const r = await api.addFolders()
              update(r.settings)
              if (r.error) setToast({ kind: 'error', text: r.error })
            }}
          >
            + Add folder
          </button>
          <button
            className="primary wide"
            onClick={scanning ? api.cancelScan : doScan}
            disabled={!settings.parentFolders.length}
          >
            {scanning ? 'Cancel scan' : result ? 'Rescan' : 'Scan'}
          </button>

          {scanning && (
            <div className="progress">
              <div className="bar" />
              <div className="pstat">
                {progress?.found ?? 0} items · {formatBytes(progress?.totalBytes ?? 0)}
              </div>
              <div className="pcurrent" title={progress?.current}>
                {progress?.current ?? 'starting…'}
              </div>
            </div>
          )}

          {result && (
            <label className="row" style={{ marginTop: 14 }}>
              <input
                type="checkbox"
                checked={settings.oldOnly}
                onChange={(e) => save({ oldOnly: e.target.checked })}
              />
              <span>
                Only untouched projects
                <em>
                  <select value={settings.oldDays} onChange={(e) => save({ oldDays: Number(e.target.value) })}>
                    {[30, 60, 90].map((d) => (
                      <option key={d} value={d}>
                        {d}+ days
                      </option>
                    ))}
                  </select>
                </em>
              </span>
            </label>
          )}

          {chartProjects.length > 0 && <Charts projects={chartProjects} accent={settings.theme.accent} />}

          {byCategory.length > 0 && mode === 'redundant' && (
            <>
              <h3>Select a category</h3>
              <ul className="cats">
                {byCategory.map(([cat, c]) => {
                  const paths = visible
                    .filter((p) => !isProtected(p))
                    .flatMap((p) => p.items.filter((i) => i.category === cat).map((i) => i.path))
                  return (
                    <li key={cat}>
                      <button className="linkish" onClick={() => setSel(paths, !allSelected(paths))}>
                        {cat}
                      </button>
                      <span className="csize">{formatBytes(c.size)}</span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {result?.skipped?.length > 0 && (
            <p className="muted small">
              {result.skipped.length} path(s) skipped (locked or permission denied).
            </p>
          )}
        </aside>

        <main className="main">
          {remind && view === 'scan' && (
            <div className="banner">
              It has been over a week since your last scan.
              <span className="spacer" />
              <button className="primary tiny" onClick={doScan}>
                Scan now
              </button>
              <button className="x" onClick={() => setRemind(false)}>
                ×
              </button>
            </div>
          )}
          {toast && (
            <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
              <div>
                {toast.text}
                {toast.detail?.length > 0 && (
                  <ul>
                    {toast.detail.slice(0, 5).map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {view === 'settings' ? (
            <Settings settings={settings} onChange={update} />
          ) : view === 'reports' ? (
            <Reports accent={settings.theme.accent} />
          ) : !result ? (
            <div className="empty">
              <h2>Ready when you are</h2>
              <p>
                Add the folder your projects live in, then hit <strong>Scan</strong>. DevBroom looks for
                node_modules, build output, caches and other regenerable junk — and never touches your source.
              </p>
            </div>
          ) : (
            <>
              {/* mode switcher + list toolbar */}
              <div className="modes">
                {[
                  ['redundant', 'Redundant Files'],
                  ['projects', 'Projects']
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={mode === id ? 'on' : ''}
                    onClick={() => {
                      setMode(id)
                      setSelected(new Set())
                    }}
                  >
                    {label}
                  </button>
                ))}
                <span className="spacer" />
                <span className="muted small">
                  Last scanned: {result.at ? ago(result.at) : 'unknown'}
                </span>
                <button className="tiny" onClick={doScan} disabled={scanning}>
                  Rescan
                </button>
              </div>

              <div className="listbar">
                <label className="selall">
                  <TriCheckbox
                    checked={allSelected(selectablePaths)}
                    indeterminate={someSelected(selectablePaths)}
                    disabled={!selectablePaths.length}
                    onChange={(e) => setSel(selectablePaths, e.target.checked)}
                  />
                  Select all
                </label>
                <button
                  className="tiny"
                  onClick={() =>
                    setCollapsed(allCollapsed ? new Set() : new Set(visible.map((p) => p.path)))
                  }
                >
                  {allCollapsed ? 'Expand all' : 'Collapse all'}
                </button>
                <input
                  className="searchbox"
                  placeholder="Search projects by name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button className="x" onClick={() => setSearch('')} title="Clear search">
                    ×
                  </button>
                )}
                <span className="spacer" />
                <label className="sortbox">
                  Sort
                  <select value={sort} onChange={(e) => setSort(e.target.value)}>
                    <option value="size">Biggest first</option>
                    <option value="name">Project name</option>
                  </select>
                </label>
                <span className="muted small">{visible.length} projects</span>
              </div>

              {visible.length === 0 ? (
                <div className="empty">
                  <h2>Nothing to show</h2>
                  <p>
                    {search
                      ? `No project matches "${search}".`
                      : settings.oldOnly
                        ? `No project has been untouched for ${settings.oldDays}+ days.`
                        : mode === 'redundant'
                          ? 'No cleanable items were found.'
                          : 'No projects were found.'}
                  </p>
                </div>
              ) : (
                visible.map((p) => {
                  const paths = mode === 'projects' ? [p.path] : p.items.map((i) => i.path)
                  const locked = isProtected(p)
                  const isCollapsed = collapsed.has(p.path)
                  return (
                    <section className={`project ${locked ? 'locked' : ''}`} key={p.path}>
                      <header>
                        <TriCheckbox
                          checked={!locked && allSelected(paths)}
                          indeterminate={!locked && someSelected(paths)}
                          disabled={locked}
                          onChange={(e) => setSel(paths, e.target.checked)}
                        />
                        <button
                          className="collapse"
                          onClick={() =>
                            setCollapsed((c) => {
                              const n = new Set(c)
                              n.has(p.path) ? n.delete(p.path) : n.add(p.path)
                              return n
                            })
                          }
                        >
                          {isCollapsed ? '▸' : '▾'}
                        </button>
                        <button
                          className={`star ${locked ? 'on' : ''}`}
                          title={locked ? 'Protected — click to unprotect' : 'Protect this project from deletion'}
                          onClick={() => toggleProtected(p)}
                        >
                          {locked ? '★' : '☆'}
                        </button>
                        <span className="pname">{p.name}</span>
                        {locked && <span className="badge accent">Protected</span>}
                        <span className={`badge ${isRecent(p) ? 'warn' : ''}`}>Edited {ago(p.lastModified)}</span>
                        <span className="ppath" title={p.path}>
                          {p.path}
                        </span>
                        <span className="spacer" />
                        <AiButton id={p.path} projectPath={p.path} />
                        <button
                          className="linkish"
                          onClick={async () => {
                            update(
                              await api.setSettings({
                                exclusions: [...new Set([...settings.exclusions, p.path])]
                              })
                            )
                            setToast({ kind: 'info', text: `Excluded ${p.path} from future scans.` })
                          }}
                        >
                          exclude
                        </button>
                        <span className="psize">{formatBytes(projectSize(p))}</span>
                      </header>
                      <AiPanel id={p.path} />
                      {!isCollapsed && mode === 'projects' && (
                        <ul className="items">
                          <li className="projmeta">
                            <span className="muted">
                              {p.items.length
                                ? `${p.items.length} cleanable item(s) inside · ${formatBytes(
                                    p.items.reduce((s, i) => s + i.size, 0)
                                  )} of it is regenerable`
                                : 'No cleanable items inside — this is all source.'}
                            </span>
                            <span className="spacer" />
                            <span className="ipath" onClick={() => api.reveal(p.path)}>
                              open folder
                            </span>
                          </li>
                        </ul>
                      )}
                      {!isCollapsed && mode === 'redundant' && (
                        <ul className="items">
                          {[...p.items]
                            .sort((a, b) => b.size - a.size)
                            .map((i) => (
                              <li key={i.path} className={i.safe ? '' : 'review'}>
                                <input
                                  type="checkbox"
                                  checked={selected.has(i.path)}
                                  disabled={locked}
                                  onChange={(e) => setSel([i.path], e.target.checked)}
                                />
                                <span className="iname">{i.name}</span>
                                <span className="badge">{i.category}</span>
                                {!i.safe && <span className="badge warn">review</span>}
                                <span className="ipath" title={i.path} onClick={() => api.reveal(i.path)}>
                                  {i.path}
                                </span>
                                <AiButton id={i.path} projectPath={p.path} item={i} />
                                <span className="isize">{formatBytes(i.size)}</span>
                              </li>
                            ))}
                        </ul>
                      )}
                      {!isCollapsed &&
                        mode === 'redundant' &&
                        p.items.map((i) => <AiPanel key={i.path} id={i.path} />)}
                    </section>
                  )
                })
              )}
            </>
          )}
        </main>
      </div>

      {confirming && (
        <div className="modal-backdrop" onClick={() => !deleting && setConfirming(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {deleting ? (
              <>
                <h2>{settings.permanentDelete ? 'Deleting…' : 'Moving to Recycle Bin…'}</h2>
                <p>
                  {Math.min(deleting.done + 1, deleting.total)} of {deleting.total} · {pct}%
                </p>
                <div className="track">
                  <div style={{ width: `${pct}%` }} />
                </div>
                <div className="delcurrent" title={deleting.current}>
                  {deleting.current || 'finishing up…'}
                </div>
                <p className="muted small" style={{ marginTop: 10 }}>
                  This runs in the background — minimising or closing this window will not stop it.
                </p>
              </>
            ) : (
              <>
                <h2>
                  {mode === 'projects'
                    ? settings.permanentDelete
                      ? 'Permanently delete entire projects?'
                      : 'Delete entire projects?'
                    : settings.permanentDelete
                      ? 'Permanently delete?'
                      : 'Move to Recycle Bin?'}
                </h2>
                <p>
                  <strong>{selectedItems.length}</strong>{' '}
                  {mode === 'projects' ? 'project folder(s)' : 'item(s)'}, freeing{' '}
                  <strong>{formatBytes(selectedBytes)}</strong>.
                </p>
                <ul className="preview">
                  {selectedItems.slice(0, 8).map((i) => (
                    <li key={i.path}>
                      {mode === 'projects' ? i.name : i.path}{' '}
                      <span className="isize">{formatBytes(i.size)}</span>
                    </li>
                  ))}
                  {selectedItems.length > 8 && (
                    <li className="muted">…and {selectedItems.length - 8} more</li>
                  )}
                </ul>

                {mode === 'projects' && (
                  <label className="ackbox" style={{ marginBottom: 8 }}>
                    <input
                      type="checkbox"
                      checked={ack.projects}
                      onChange={(e) => setAck({ ...ack, projects: e.target.checked })}
                    />
                    This deletes the <strong>entire project folder</strong>, source code included — not just
                    the regenerable parts. I have checked the list above.
                  </label>
                )}
                {touchesRecent && (
                  <label className="ackbox" style={{ marginBottom: 8 }}>
                    <input
                      type="checkbox"
                      checked={ack.recent}
                      onChange={(e) => setAck({ ...ack, recent: e.target.checked })}
                    />
                    Some of these projects were edited in the last {RECENT_DAYS} days. Clean them anyway.
                  </label>
                )}
                {settings.permanentDelete ? (
                  <label className="ackbox">
                    <input
                      type="checkbox"
                      checked={ack.permanent}
                      onChange={(e) => setAck({ ...ack, permanent: e.target.checked })}
                    />
                    Permanent delete is ON. These items will <strong>not</strong> go to the Recycle Bin and
                    cannot be recovered.
                  </label>
                ) : (
                  <p className="muted">
                    Items go to your Windows Recycle Bin / system Trash — restore them from there if needed.
                  </p>
                )}
                <div className="modal-actions">
                  <button onClick={() => setConfirming(false)}>Cancel</button>
                  <button
                    className="danger"
                    disabled={
                      (settings.permanentDelete && !ack.permanent) ||
                      (touchesRecent && !ack.recent) ||
                      (mode === 'projects' && !ack.projects)
                    }
                    onClick={doDelete}
                  >
                    {settings.permanentDelete ? 'Delete forever' : 'Move to Recycle Bin'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
