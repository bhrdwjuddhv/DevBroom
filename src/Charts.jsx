import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { chartColors } from './theme.js'
import { formatBytes } from './format.js'

const tooltipStyle = {
  background: 'var(--surface-2)',
  border: '1px solid var(--line-strong)',
  borderRadius: 6,
  color: 'var(--text)'
}

export default function Charts({ projects, accent }) {
  const byCategory = new Map()
  for (const p of projects)
    for (const i of p.items) byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + i.size)

  const cats = [...byCategory.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
  const total = cats.reduce((s, c) => s + c.value, 0)
  if (!total) return null

  const catColors = chartColors(accent, Math.max(cats.length, 1))
  const top = projects
    .map((p) => ({ name: p.name, value: p.items.reduce((s, i) => s + i.size, 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
  const projColors = chartColors(accent, Math.max(top.length, 1))

  return (
    <>
      <h3>By category</h3>
      <div className="chartcard">
        <div className="donutwrap">
          <ResponsiveContainer width="100%" height={150}>
            <PieChart>
              <Pie
                data={cats}
                dataKey="value"
                nameKey="name"
                innerRadius={44}
                outerRadius={68}
                paddingAngle={2}
                stroke="none"
                isAnimationActive={false}
              >
                {cats.map((c, i) => (
                  <Cell key={c.name} fill={catColors[i]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatBytes(v)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="donutcenter">
            <b>{formatBytes(total)}</b>
            <span>selected total</span>
          </div>
        </div>
        <ul className="chartlegend">
          {cats.map((c, i) => (
            <li key={c.name}>
              <i style={{ background: catColors[i] }} />
              {c.name}
              <span className="csize">{formatBytes(c.value)}</span>
            </li>
          ))}
        </ul>
      </div>

      <h3>Top projects</h3>
      <div className="chartcard">
        <ResponsiveContainer width="100%" height={Math.max(90, top.length * 30)}>
          <BarChart data={top} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={92}
              tick={{ fill: 'var(--dim)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: 'var(--hover)' }}
              contentStyle={tooltipStyle}
              formatter={(v) => formatBytes(v)}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {top.map((p, i) => (
                <Cell key={p.name} fill={projColors[i]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}
