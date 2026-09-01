import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatBytes } from './format.js'
import { accentOf } from './theme.js'

const api = window.devbroom

const duration = (ms) => {
  if (ms == null) return null
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} seconds`
  const m = Math.floor(s / 60)
  return `${m} min ${Math.round(s - m * 60)} s`
}

const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10)

function Tile({ icon, label, value, sub }) {
  return (
    <div className="tile">
      <div className="tlabel">
        <span className="ticon">{icon}</span>
        {label}
      </div>
      <div className="tvalue">{value}</div>
      {sub && <div className="tsub">{sub}</div>}
    </div>
  )
}

export default function Reports({ accent }) {
  const [reports, setReports] = useState([])
  const [open, setOpen] = useState(null)
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    api.reports().then(setReports)
  }, [])

  const color = accentOf(accent).accent

  // this calendar month, not a rolling 30 days — "cleanups this month" should reset on the 1st
  const month = useMemo(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const inMonth = reports.filter((r) => r.at >= start)
    return {
      label: now.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
      count: inMonth.length,
      freed: inMonth.reduce((s, r) => s + r.freed, 0),
      items: inMonth.reduce((s, r) => s + r.items.length, 0)
    }
  }, [reports])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const fromTs = from ? new Date(from).setHours(0, 0, 0, 0) : null
    const toTs = to ? new Date(to).setHours(23, 59, 59, 999) : null
    return reports.filter((r) => {
      if (fromTs && r.at < fromTs) return false
      if (toTs && r.at > toTs) return false
      if (!needle) return true
      return r.items.some(
        (i) =>
          (i.project ?? '').toLowerCase().includes(needle) || (i.path ?? '').toLowerCase().includes(needle)
      )
    })
  }, [reports, q, from, to])

  // one point per day so a busy day reads as a single peak rather than several spikes
  const trend = useMemo(() => {
    const byDay = new Map()
    for (const r of [...filtered].sort((a, b) => a.at - b.at))
      byDay.set(dayKey(r.at), (byDay.get(dayKey(r.at)) ?? 0) + r.freed)
    return [...byDay.entries()].map(([day, freed]) => ({ day: day.slice(5), freed }))
  }, [filtered])

  const allTime = reports.reduce((s, r) => s + r.freed, 0)

  if (!reports.length)
    return (
      <div className="empty">
        <div className="emptyart">🧹</div>
        <h2>No cleanups yet</h2>
        <p>
          Once you clean something, every run is logged here — what was removed, how long it took, how
          much it freed, and anything that failed.
        </p>
      </div>
    )

  return (
    <div className="reports">
      <div className="stattiles">
        <Tile icon="🧹" label={`Cleanups · ${month.label}`} value={month.count} sub={`${month.items} items removed`} />
        <Tile icon="💾" label="Freed this month" value={formatBytes(month.freed)} sub={`${formatBytes(allTime)} all time`} />
      </div>

      {trend.length > 1 && (
        <>
          <h2 className="sectionhead">Space freed over time</h2>
          <div className="chartcard" style={{ padding: 12 }}>
            <ResponsiveContainer width="100%" height={190}>
              <AreaChart data={trend} margin={{ left: 0, right: 8, top: 6, bottom: 0 }}>
                <defs>
                  <linearGradient id="freedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: 'var(--dim)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis
                  tickFormatter={(v) => formatBytes(v)}
                  tick={{ fill: 'var(--dim)', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                />
                <Tooltip
                  cursor={{ stroke: color, strokeOpacity: 0.35 }}
                  contentStyle={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line-strong)',
                    borderRadius: 6,
                    color: 'var(--text)'
                  }}
                  formatter={(v) => [formatBytes(v), 'freed']}
                />
                <Area type="monotone" dataKey="freed" stroke={color} strokeWidth={2} fill="url(#freedFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <h2 className="sectionhead">History</h2>
      <div className="listbar">
        <input
          className="searchbox"
          placeholder="Filter by project name or path…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="sortbox">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="sortbox">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(q || from || to) && (
          <button
            className="tiny"
            onClick={() => {
              setQ('')
              setFrom('')
              setTo('')
            }}
          >
            Reset
          </button>
        )}
        <span className="spacer" />
        <span className="muted small">
          {filtered.length} of {reports.length}
        </span>
        <button
          className="tiny"
          onClick={async () => {
            setReports(await api.clearReports())
            setOpen(null)
          }}
        >
          Clear all
        </button>
      </div>

      {filtered.length === 0 && <p className="muted">No cleanup matches those filters.</p>}

      {filtered.map((r) => {
        const isOpen = open === r.id
        const cats = [
          ...r.items.reduce((m, i) => m.set(i.category, (m.get(i.category) ?? 0) + i.size), new Map())
        ].sort((a, b) => b[1] - a[1])
        const biggest = cats[0]?.[1] || 1
        return (
          <article className={`rcard ${isOpen ? 'open' : ''}`} key={r.id}>
            <header onClick={() => setOpen(isOpen ? null : r.id)}>
              <span className="chev">▸</span>
              <div>
                <div className="rwhen">{new Date(r.at).toLocaleString()}</div>
                <div className="rmeta">
                  <span>{r.destination}</span>
                  {r.mode && <span>· {r.mode}</span>}
                  <span>· {r.items.length} items</span>
                  {r.durationMs != null && <span>· {duration(r.durationMs)}</span>}
                  {r.failed?.length > 0 && <span>· {r.failed.length} failed</span>}
                  {r.stopped && <span>· stopped early</span>}
                </div>
              </div>
              <span className="rfreed">{formatBytes(r.freed)}</span>
              <button
                className="x"
                title="Delete this report"
                onClick={async (e) => {
                  e.stopPropagation()
                  setReports(await api.deleteReport(r.id))
                  setOpen(null)
                }}
              >
                ×
              </button>
            </header>

            {isOpen && (
              <div className="rbody">
                {cats.length > 0 && (
                  <>
                    <h4>By category</h4>
                    {cats.map(([cat, size]) => (
                      <div className="catbar" key={cat}>
                        <span className="cname">{cat}</span>
                        <span className="track">
                          <div style={{ width: `${(size / biggest) * 100}%` }} />
                        </span>
                        <span className="csize">{formatBytes(size)}</span>
                      </div>
                    ))}
                  </>
                )}

                <h4>Deleted items ({r.items.length})</h4>
                <ul className="ritems">
                  {r.items.map((i) => (
                    <li key={i.path}>
                      <span title={i.path}>
                        {i.project} — {i.path}
                      </span>
                      <span>{formatBytes(i.size)}</span>
                    </li>
                  ))}
                </ul>

                {r.failed?.length > 0 && (
                  <>
                    <h4>Failed ({r.failed.length})</h4>
                    <ul className="ritems">
                      {r.failed.map((f) => (
                        <li className="bad" key={f.path}>
                          <span title={f.path}>{f.path}</span>
                          <span>{f.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {r.diskBefore && r.diskAfter && (
                  <p className="muted small" style={{ marginTop: 12 }}>
                    Disk {r.diskBefore.drive}: {formatBytes(r.diskBefore.free)} →{' '}
                    {formatBytes(r.diskAfter.free)} free
                  </p>
                )}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
