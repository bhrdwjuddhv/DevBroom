import { useEffect, useState } from 'react'
import { ACCENTS } from './theme.js'
import { formatBytes } from './format.js'

const api = window.devbroom

export default function Settings({ settings, onChange }) {
  const [pattern, setPattern] = useState('')
  const [kind, setKind] = useState('folder')
  const [category, setCategory] = useState('Custom')
  const [models, setModels] = useState(settings.models ?? [])
  const [dl, setDl] = useState(null) // { id, received, total }
  const [dlError, setDlError] = useState(null)

  useEffect(() => api.onAiDownloadProgress((p) => setDl(p)), [])

  const save = async (patch) => onChange(await api.setSettings(patch))
  const setRules = (rules) => save({ rules })
  const setTheme = (patch) => save({ theme: { ...settings.theme, ...patch } })
  const categories = [...new Set(settings.rules.map((r) => r.category))]

  const addRule = () => {
    const p = pattern.trim()
    if (!p) return
    const id = `${kind}:${p}`
    if (settings.rules.some((r) => r.id === id)) return setPattern('')
    setRules([...settings.rules, { id, pattern: p, kind, category, enabled: true, safe: true, custom: true }])
    setPattern('')
  }

  const download = async (id) => {
    setDlError(null)
    setDl({ id, received: 0, total: 0 })
    const res = await api.aiDownload(id)
    setDl(null)
    setModels(res.models)
    if (!res.ok) setDlError(res.error)
    else if (!settings.aiModel) save({ aiModel: id })
  }

  return (
    <div className="settings">
      {/* ---------- appearance ---------- */}
      <section className="card">
        <h2>Appearance</h2>
        <div className="row">
          <span style={{ minWidth: 90 }}>Mode</span>
          <div className="segmented">
            {['light', 'dark'].map((m) => (
              <button key={m} className={settings.theme.mode === m ? 'on' : ''} onClick={() => setTheme({ mode: m })}>
                {m === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <span style={{ minWidth: 90 }}>Accent</span>
          <div className="swatches">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                className={`swatch ${settings.theme.accent === a.id ? 'on' : ''}`}
                onClick={() => setTheme({ accent: a.id })}
              >
                <i style={{ background: a.accent, boxShadow: `0 0 10px ${a.glow}` }} />
                {a.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- deletion ---------- */}
      <section className="card">
        <h2>Deletion</h2>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.permanentDelete}
            onChange={(e) => save({ permanentDelete: e.target.checked })}
          />
          <span>
            <strong>Permanently delete instead of Recycle Bin</strong>
            <em>
              Off by default. When off, everything goes to your Windows Recycle Bin / system Trash and you can
              restore it from there. When on, DevBroom requires an extra confirmation every time.
            </em>
          </span>
        </label>
        {settings.permanentDelete && (
          <p className="warnbox">Permanent delete is ON — deleted items cannot be recovered.</p>
        )}
        <label className="row">
          <input
            type="checkbox"
            checked={settings.weeklyReminder}
            onChange={(e) => save({ weeklyReminder: e.target.checked })}
          />
          <span>
            <strong>Remind me to scan weekly</strong>
            <em>
              Shows a banner and a desktop notification on launch when it has been more than 7 days.
              {settings.lastScan
                ? ` Last scan: ${new Date(settings.lastScan).toLocaleString()}.`
                : ' No scan recorded yet.'}
            </em>
          </span>
        </label>
      </section>

      {/* ---------- ai ---------- */}
      <section className="card">
        <h2>Project AI Helper</h2>
        <p className="muted">
          Optional. Runs a small model locally with node-llama-cpp — nothing leaves your machine, and it works
          offline once downloaded. DevBroom works normally without it.
        </p>
        <p className="muted">
          Smaller models are faster but give rougher summaries. The Recommended model needs a bit more memory
          but is much more accurate.
        </p>
        <p className="hwtip">
          Not sure? On 8 GB RAM pick Balanced. On 16 GB+ pick Recommended for the best answers.
        </p>
        <ul className="models">
          {(models.length ? models : settings.models ?? []).map((m) => {
            const active = settings.aiModel === m.id
            const busy = dl?.id === m.id
            return (
              <li key={m.id}>
                <div style={{ flex: 1 }}>
                  <div className="mname">
                    {m.name}{' '}
                    {m.tag && <span className="badge accent">{m.tag}</span>}{' '}
                    {active && <span className="badge accent">active</span>}{' '}
                    {m.downloaded && !active && <span className="badge">downloaded</span>}
                  </div>
                  <div className="mmeta">
                    {m.about} · {formatBytes(m.downloaded ? m.onDisk : m.bytes)}
                  </div>
                  <div className="hwbadge">{m.hw}</div>
                  {busy && (
                    <>
                      <div className="track" style={{ marginTop: 6 }}>
                        <div style={{ width: `${dl.total ? (dl.received / dl.total) * 100 : 0}%` }} />
                      </div>
                      <div className="mmeta">
                        {formatBytes(dl.received)} of {formatBytes(dl.total || m.bytes)}
                      </div>
                    </>
                  )}
                </div>
                {busy ? (
                  <button onClick={() => api.aiCancelDownload()}>Cancel</button>
                ) : m.downloaded ? (
                  <>
                    {!active && (
                      <button className="primary" onClick={() => save({ aiModel: m.id })}>
                        Use
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        setModels(await api.aiRemove(m.id))
                        onChange(await api.getSettings())
                      }}
                    >
                      Delete
                    </button>
                  </>
                ) : (
                  <button className="primary" disabled={!!dl} onClick={() => download(m.id)}>
                    Download
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        {dlError && <p className="warnbox">{dlError}</p>}
      </section>

      {/* ---------- rules ---------- */}
      <section className="card">
        <h2>Cleanup rules</h2>
        <p className="muted">
          A rule matches a folder name or a file pattern. <code>*</code> is a wildcard, e.g. <code>*.log</code>.
        </p>
        {categories.map((cat) => {
          const rules = settings.rules.filter((r) => r.category === cat)
          const safe = rules.every((r) => r.safe)
          return (
            <div className="rulecat" key={cat}>
              <h3>
                {cat}{' '}
                <span className={`badge ${safe ? '' : 'warn'}`}>{safe ? 'safe' : 'review carefully'}</span>
              </h3>
              <p className="muted small">{settings.categoryNotes?.[cat] ?? 'Custom rules you added.'}</p>
              <ul className="rules">
                {rules.map((r) => (
                  <li key={r.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) =>
                          setRules(
                            settings.rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x))
                          )
                        }
                      />
                      <code>{r.pattern}</code>
                      <span className="muted small">{r.kind}</span>
                    </label>
                    {r.custom && (
                      <button
                        className="x"
                        title="Delete rule"
                        onClick={() => setRules(settings.rules.filter((x) => x.id !== r.id))}
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}

        <div className="addrule">
          <input
            placeholder="folder name or pattern (e.g. .venv or *.tsbuildinfo)"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRule()}
          />
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="folder">folder</option>
            <option value="file">file</option>
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {[...new Set([...categories, 'Custom'])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button className="primary" onClick={addRule}>
            Add rule
          </button>
        </div>
      </section>

      {/* ---------- exclusions ---------- */}
      <section className="card">
        <h2>Exclusions</h2>
        <p className="muted">These paths (and everything inside them) are skipped in every scan.</p>
        {settings.exclusions.length === 0 && <p className="muted small">Nothing excluded yet.</p>}
        <ul className="folders">
          {settings.exclusions.map((f) => (
            <li key={f}>
              <span className="path" title={f}>
                {f}
              </span>
              <button className="x" onClick={() => save({ exclusions: settings.exclusions.filter((x) => x !== f) })}>
                ×
              </button>
            </li>
          ))}
        </ul>
        <button onClick={async () => onChange(await api.addExclusion())}>+ Add excluded folder</button>
      </section>

      {/* ---------- about ---------- */}
      <section className="card about">
        <h2>About</h2>
        <dl className="facts">
          <dt>App</dt>
          <dd>
            {settings.about?.name} {settings.about?.version}
          </dd>
          <dt>What it is</dt>
          <dd>{settings.about?.description}</dd>
          <dt>Repository</dt>
          <dd>
            <button className="linkish" onClick={() => api.openExternal(settings.about?.homepage)}>
              {settings.about?.homepage}
            </button>
          </dd>
          <dt>License</dt>
          <dd>{settings.about?.license}</dd>
          <dt>Author</dt>
          <dd>{settings.about?.author}</dd>
          <dt>Built with</dt>
          <dd>
            Electron {settings.about?.electron} · Node {settings.about?.node}
          </dd>
        </dl>
        <p className="muted small">
          Fully local — no analytics, no telemetry, no network calls except when you choose to download an
          AI model.
        </p>
      </section>
    </div>
  )
}
