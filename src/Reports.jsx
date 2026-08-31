import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatBytes } from './format.js'
import { accentOf } from './theme.js'

const api = window.devbroom

const duration = (ms) => {
  if (!ms && ms !== 0) return null
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} seconds`
  const m = Math.floor(s / 60)
  return `${m} min ${Math.round(s - m * 60)} s`
}

const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10)

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
      freed: inMonth.reduce((s, r) => s + r.freed, 0)
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

  // one point per day so a busy day reads as a single bar rather than several spikes
  const trend = useMemo(() => {
    const byDay = new Map()
    for (const r of [...filtered].sort((a, b) => a.at - b.at)) {
      byDay.set(dayKey(r.at), (byDay.get(dayKey(r.at)) ?? 0) + r.freed)
    }
    return [...byDay.entries()].map(([day, freed]) => ({ day: day.slice(5), freed }))
  }, [filtered])

  const detail = filtered.find((r) => r.id === open)

  if (!reports.length)
    return (
      <div className="empty">
        <h2>No cleanups yet</h2>
        <p>Every cleanup is logged here: what was removed, how long it took, and how much it freed.</p>
      </div>
    )

  return (
    <div className="reports">
      <div className="monthcard">
        <div>
          <div className="total-label">{month.label}</div>
          <div className="monthnums">
            <span>
              <b>{month.count}</b> cleanup{month.count === 1 ? '' : 's'}
            </span>
            <span>
              <b>{formatBytes(month.freed)}</b> freed
            </span>
          </div>
        </div>
        <span className="spacer" />
        <button
          onClick={async () => {
            setReports(await api.clearReports())
            setOpen(null)
          }}
        >
          Clear all reports
        </button>
      </div>

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
      </div>

      {trend.length > 1 && (
        <div className="chartcard" style={{ padding: 12 }}>
          <div className="total-label" style={{ marginBottom: 8 }}>
            Space freed over time
          </div>
          <ResponsiveContainer width="100%" height={170}>
            <AreaChart data={trend} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
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
      )}

      <ul className="reportlist">
        {filtered.map((r) => (
          <li key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
            <span>{new Date(r.at).toLocaleString()}</span>
            <span className="badge">{r.destination}</span>
            {r.mode && <span className="badge">{r.mode}</span>}
            <span className="muted small">
              {r.items.length} item(s)
              {r.durationMs != null && ` · ${duration(r.durationMs)}`}
            </span>
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
          </li>
        ))}
      </ul>

      {detail && (
        <div className="card rdetail">
          <h2>{new Date(detail.at).toLocaleString()}</h2>
          <p className="muted">
            Freed <strong>{formatBytes(detail.freed)}</strong>
            {detail.durationMs != null && ` in ${duration(detail.durationMs)}`} · sent to{' '}
            {detail.destination}
            {detail.diskBefore && detail.diskAfter && (
              <>
                {' '}
                · {detail.diskBefore.drive} {formatBytes(detail.diskBefore.free)} →{' '}
                {formatBytes(detail.diskAfter.free)} free
              </>
            )}
          </p>

          <h3 style={{ fontSize: 12 }}>By category</h3>
          <ul>
            {[
              ...detail.items.reduce((m, i) => m.set(i.category, (m.get(i.category) ?? 0) + i.size), new Map())
            ].map(([cat, size]) => (
              <li key={cat}>
                <span>{cat}</span>
                <span>{formatBytes(size)}</span>
              </li>
            ))}
          </ul>

          <h3 style={{ fontSize: 12 }}>Deleted items ({detail.items.length})</h3>
          <ul>
            {detail.items.map((i) => (
              <li key={i.path}>
                <span title={i.path}>
                  {i.project} — {i.path}
                </span>
                <span>{formatBytes(i.size)}</span>
              </li>
            ))}
            {detail.failed?.map((f) => (
              <li key={f.path} className="muted">
                <span>failed: {f.path}</span>
                <span>{f.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
