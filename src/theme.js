export const ACCENTS = [
  { id: 'crimson', name: 'Crimson', accent: '#C90003', glow: '#660808' },
  { id: 'emerald', name: 'Emerald', accent: '#10B981', glow: '#065F46' },
  { id: 'violet', name: 'Violet', accent: '#8B5CF6', glow: '#4C1D95' },
  { id: 'amber', name: 'Amber', accent: '#F59E0B', glow: '#92400E' },
  { id: 'ocean', name: 'Ocean Blue', accent: '#3B82F6', glow: '#1E3A8A' },
  { id: 'teal', name: 'Teal', accent: '#06B6D4', glow: '#164E63' }
]

export const accentOf = (id) => ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]

export function applyTheme({ mode = 'dark', accent = 'crimson' } = {}) {
  const a = accentOf(accent)
  const root = document.documentElement
  root.dataset.theme = mode
  root.style.setProperty('--accent', a.accent)
  root.style.setProperty('--glow', a.glow)
}

const hexToHsl = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (!d) return [0, 0, l * 100]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h =
    max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(h * 60 + 360) % 360, s * 100, l * 100]
}

/** A chart ramp built from the active accent: same family, spread over hue and lightness. */
export function chartColors(accentId, count) {
  const [h, s, l] = hexToHsl(accentOf(accentId).accent)
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1)
    return `hsl(${(h + t * 55) % 360} ${Math.max(35, s - t * 22)}% ${Math.min(78, l + t * 30)}%)`
  })
}
