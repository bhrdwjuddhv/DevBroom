import { useEffect, useState } from 'react'
import { formatBytes } from './format.js'

const api = window.devbroom

export default function Reports() {
  const [reports, setReports] = useState([])
  const [open, setOpen] = useState(null)

  useEffect(() => {
    api.reports().then(setReports)
  }, [])

  if (!reports.length)
    return (
      <div className="empty">
        <h2>No cleanups yet</h2>
        <p>Every cleanup is logged here: what was removed, how much space it freed, and where it went.</p>
      </div>
    )

  const detail = reports.find((r) => r.id === open)

  return (
    <div className="reports">
      <div className="row" style={{ alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Cleanup history</h2>
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

      <ul className="reportlist">
        {reports.map((r) => (
          <li key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
            <span>{new Date(r.at).toLocaleString()}</span>
            <span className="badge">{r.destination}</span>
            <span className="muted small">{r.items.length} item(s)</span>
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
            {formatBytes(detail.freed)} freed · sent to {detail.destination}
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
            {[...detail.items.reduce((m, i) => m.set(i.category, (m.get(i.category) ?? 0) + i.size), new Map())].map(
              ([cat, size]) => (
                <li key={cat}>
                  <span>{cat}</span>
                  <span>{formatBytes(size)}</span>
                </li>
              )
            )}
          </ul>

          <h3 style={{ fontSize: 12 }}>Items</h3>
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
