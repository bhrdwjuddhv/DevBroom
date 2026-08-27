import { useEffect, useMemo, useState } from 'react'
import Settings from './Settings.jsx'
import Reports from './Reports.jsx'
import Charts from './Charts.jsx'
import { applyTheme } from './theme.js'
import { DAY, ago, formatBytes } from './format.js'
import icon from './public/icon.png'

const api = window.devbroom
const RECENT_DAYS = 7
const WEEK = 7 * DAY

export default function App() {
  const [settings, setSettings] = useState(null)
  const [view, setView] = useState('scan')
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [sort, setSort] = useState('size')
  const [confirming, setConfirming] = useState(false)
  const [ack, setAck] = useState({ permanent: false, recent: false })
  const [deleting, setDeleting] = useState(null)
  const [disk, setDisk] = useState(null)
  const [diskGain, setDiskGain] = useState(null)
  const [toast, setToast] = useState(null)
  const [ai, setAi] = useState(null)
  const [remind, setRemind] = useState(false)

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s)
      applyTheme(s.theme)
      if (s.weeklyReminder && (!s.lastScan || Date.now() - s.lastScan > WEEK)) {
        setRemind(true)
        api.notify('DevBroom', "It's been a week since your last scan.")
      }
    })
    const offScan = api.onScanProgress(setProgress)
    const offDel = api.onDeleteProgress((p) => setDeleting((d) => ({ ...d, ...p })))
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
  const visible = useMemo(() => {
    const cutoff = Date.now() - (settings?.oldDays ?? 30) * DAY
    const filtered = settings?.oldOnly ? projects.filter((p) => (p.lastModified || 0) < cutoff) : projects
    const size = (p) => p.items.reduce((s, i) => s + i.size, 0)
    return [...filtered].sort((a, b) =>
      sort === 'size' ? size(b) - size(a) : a.name.localeCompare(b.name)
    )
  }, [projects, sort, settings?.oldOnly, settings?.oldDays])

  const allItems = useMemo(() => visible.flatMap((p) => p.items), [visible])
  const visibleBytes = allItems.reduce((s, i) => s + i.size, 0)
  const selectedItems = useMemo(
    () =>
      visible.flatMap((p) =>
        p.items.filter((i) => selected.has(i.path)).map((i) => ({ ...i, project: p.name }))
      ),
    [visible, selected]
  )
  const selectedBytes = selectedItems.reduce((s, i) => s + i.size, 0)

  // charts follow the selection once you start picking, otherwise show everything visible
  const chartProjects = useMemo(() => {
    if (!selected.size) return visible
    return visible
      .map((p) => ({ ...p, items: p.items.filter((i) => selected.has(i.path)) }))
      .filter((p) => p.items.length)
  }, [visible, selected])

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
  const isRecent = (p) => p.lastModified && Date.now() - p.lastModified < RECENT_DAYS * DAY
  const touchesRecent = visible.some((p) => isRecent(p) && p.items.some((i) => selected.has(i.path)))

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
    setSettings((s) => ({ ...s, lastScan: Date.now() }))
    api.diskFree().then(setDisk)
    if (!res.projects.length) setToast({ kind: 'info', text: 'Nothing cleanable found in those folders.' })
  }

  async function doDelete() {
    setDeleting({ done: 0, total: selectedItems.length, current: '' })
    const res = await api.deleteItems(selectedItems)
    setDeleting(null)
    setConfirming(false)
    setAck({ permanent: false, recent: false })
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

  async function askAi(key, projectPath, item) {
    setAi({ key, text: '', loading: true, error: null, facts: null })
    // facts are read straight off disk, so they land immediately and never depend on the model
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

        {/* FACTS — read from the project's own files by the app, never written by the model */}
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={icon} alt="" />
          DevBroom
        </div>
        <div className="totals">
          <div className="total-num">{formatBytes(visibleBytes)}</div>
          <div className="total-label">total space you can recover</div>
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
            <label className="sortbox">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="size">Biggest first</option>
                <option value="name">Project name</option>
              </select>
            </label>
            <div className="selinfo">
              {selected.size} selected · <strong>{formatBytes(selectedBytes)}</strong>
            </div>
            <button className="danger" disabled={!selected.size || scanning} onClick={() => setConfirming(true)}>
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
            {scanning ? 'Cancel scan' : 'Scan'}
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
                  <select
                    value={settings.oldDays}
                    onChange={(e) => save({ oldDays: Number(e.target.value) })}
                  >
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

          {byCategory.length > 0 && (
            <>
              <h3>Select</h3>
              <ul className="cats">
                {byCategory.map(([cat, c]) => {
                  const paths = allItems.filter((i) => i.category === cat).map((i) => i.path)
                  return (
                    <li key={cat}>
                      <button
                        className="linkish"
                        onClick={() => setSel(paths, !allSelected(paths))}
                        title={`Select every ${cat} item`}
                      >
                        {cat}
                      </button>
                      <span className="csize">{formatBytes(c.size)}</span>
                    </li>
                  )
                })}
              </ul>
              <button
                className="wide"
                onClick={() => setSel(allItems.map((i) => i.path), !allSelected(allItems.map((i) => i.path)))}
              >
                {allSelected(allItems.map((i) => i.path)) ? 'Deselect all' : 'Select all'}
              </button>
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
            <Reports />
          ) : !result ? (
            <div className="empty">
              <h2>Ready when you are</h2>
              <p>
                Add the folder your projects live in, then hit <strong>Scan</strong>. DevBroom looks for
                node_modules, build output, caches and other regenerable junk — and never touches your source.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty">
              <h2>Nothing to show</h2>
              <p>
                {settings.oldOnly
                  ? `No project has been untouched for ${settings.oldDays}+ days. Turn off the filter to see everything.`
                  : 'No cleanable items were found.'}
              </p>
            </div>
          ) : (
            visible.map((p) => {
              const paths = p.items.map((i) => i.path)
              const total = p.items.reduce((s, i) => s + i.size, 0)
              const isCollapsed = collapsed.has(p.path)
              return (
                <section className="project" key={p.path}>
                  <header>
                    <input
                      type="checkbox"
                      checked={allSelected(paths)}
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
                    <span className="pname">{p.name}</span>
                    {isRecent(p) ? (
                      <span className="badge warn">Edited {ago(p.lastModified)}</span>
                    ) : (
                      <span className="badge">Edited {ago(p.lastModified)}</span>
                    )}
                    <span className="ppath" title={p.path}>
                      {p.path}
                    </span>
                    <span className="spacer" />
                    <AiButton id={p.path} projectPath={p.path} />
                    <button
                      className="linkish"
                      onClick={async () => {
                        update(await api.setSettings({ exclusions: [...new Set([...settings.exclusions, p.path])] }))
                        setToast({ kind: 'info', text: `Excluded ${p.path}. It will be skipped from now on.` })
                      }}
                    >
                      exclude
                    </button>
                    <span className="psize">{formatBytes(total)}</span>
                  </header>
                  <AiPanel id={p.path} />
                  {!isCollapsed && (
                    <ul className="items">
                      {[...p.items]
                        .sort((a, b) => b.size - a.size)
                        .map((i) => (
                          <li key={i.path} className={i.safe ? '' : 'review'}>
                            <input
                              type="checkbox"
                              checked={selected.has(i.path)}
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
                  {p.items.map((i) => (
                    <AiPanel key={i.path} id={i.path} />
                  ))}
                </section>
              )
            })
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
                  {Math.min(deleting.done + 1, deleting.total)} of {deleting.total} ·{' '}
                  {Math.round((deleting.done / Math.max(deleting.total, 1)) * 100)}%
                </p>
                <div className="track">
                  <div style={{ width: `${(deleting.done / Math.max(deleting.total, 1)) * 100}%` }} />
                </div>
                <div className="delcurrent" title={deleting.current}>
                  {deleting.current || 'finishing up…'}
                </div>
              </>
            ) : (
              <>
                <h2>{settings.permanentDelete ? 'Permanently delete?' : 'Move to Recycle Bin?'}</h2>
                <p>
                  <strong>{selected.size}</strong> item(s), freeing <strong>{formatBytes(selectedBytes)}</strong>.
                </p>
                <ul className="preview">
                  {selectedItems.slice(0, 8).map((i) => (
                    <li key={i.path}>
                      {i.path} <span className="isize">{formatBytes(i.size)}</span>
                    </li>
                  ))}
                  {selectedItems.length > 8 && (
                    <li className="muted">…and {selectedItems.length - 8} more</li>
                  )}
                </ul>
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
                    disabled={(settings.permanentDelete && !ack.permanent) || (touchesRecent && !ack.recent)}
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
