// Self-check for the parts of the AI helper that must be right without a model:
// node electron/ai.test.js
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { SAFETY_LINES } = require('./scanner')
const ai = require('./ai')

const t = (name, fn) =>
  fn().then(
    () => console.log('ok -', name),
    (e) => {
      console.error('FAIL -', name, e)
      process.exitCode = 1
    }
  )

const TMP_ROOT = path.join(__dirname, '..', '.tmp-tests')
fs.mkdirSync(TMP_ROOT, { recursive: true })

const tmp = (files) => {
  const root = fs.mkdtempSync(path.join(TMP_ROOT, 'ai-'))
  for (const [p, content] of Object.entries(files)) {
    const full = path.join(root, p)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content))
  }
  return root
}

t('facts detect real frameworks from package.json', async () => {
  const root = tmp({
    'package.json': {
      name: 'shoply',
      dependencies: { react: '^19.0.0', express: '^4.0.0', mongoose: '^8.0.0' },
      devDependencies: { vite: '^8.0.0', tailwindcss: '^4.0.0' }
    }
  })
  const f = await ai.facts(root, { name: 'node_modules', category: 'Dependencies' })
  assert.strictEqual(f.type, 'Node.js project')
  assert.deepStrictEqual(f.tech.sort(), ['Express', 'MongoDB (Mongoose)', 'React', 'Tailwind CSS', 'Vite'])
  fs.rmSync(root, { recursive: true, force: true })
})

t('facts fall back to marker files, then to "Unknown project type."', async () => {
  const py = tmp({ 'requirements.txt': 'flask\n' })
  assert.strictEqual((await ai.facts(py, null)).type, 'Python project')

  const nothing = tmp({ 'notes.txt': 'hi' })
  assert.strictEqual((await ai.facts(nothing, null)).type, 'Unknown project type.')

  const bare = tmp({ 'package.json': { name: 'x' } })
  assert.deepStrictEqual((await ai.facts(bare, null)).tech, ['Node.js'])
  ;[py, nothing, bare].forEach((d) => fs.rmSync(d, { recursive: true, force: true }))
})

t('safety line is fixed app text for every category, never model output', async () => {
  const root = tmp({ 'package.json': { name: 'x' } })
  const cases = [
    ['Dependencies', 'node_modules', /Safe to delete — restore anytime by running/],
    ['Build outputs', 'dist', /regenerated the next time you build/],
    ['Caches', '.vite', /rebuild automatically/],
    ['Logs & temp files', 'app.log', /Logs and temporary files\. Safe to delete\./],
    ['AI tool artifacts', '.aider.tags', /review before deleting/],
    ['OS junk', 'Thumbs.db', /Operating-system junk files\. Safe to delete\./]
  ]
  for (const [category, name, re] of cases) {
    const f = await ai.facts(root, { name, category })
    assert.strictEqual(f.safety, SAFETY_LINES[category], category)
    assert.match(f.safety, re)
    assert.doesNotMatch(f.safety, /not recoverable|cannot be recovered/i)
  }
  assert.strictEqual((await ai.facts(root, null)).safety, null, 'project-level panel has no folder line')
  fs.rmSync(root, { recursive: true, force: true })
})

t('model context carries description + README and nothing about folders', async () => {
  const root = tmp({
    'package.json': {
      name: 'shoply',
      description: 'A storefront for small bakeries.',
      scripts: { dev: 'vite', build: 'vite build' },
      dependencies: { react: '^19.0.0' }
    },
    'README.md': '# Shoply\n\nOrder management for neighbourhood bakeries.'
  })
  const ctx = await ai.summaryContext(root)
  assert.ok(ctx.hasContent)
  assert.match(ctx.text, /A storefront for small bakeries\./)
  assert.match(ctx.text, /neighbourhood bakeries/)
  assert.match(ctx.text, /Scripts: dev, build/)
  assert.doesNotMatch(ctx.text, /delete|recover|cache|node_modules/i)
  fs.rmSync(root, { recursive: true, force: true })
})

t('no description and no README skips the model entirely', async () => {
  const root = tmp({ 'package.json': { name: 'turbo-octo-dollop' }, 'index.js': '' })
  const ctx = await ai.summaryContext(root)
  assert.strictEqual(ctx.hasContent, false)
  // modelId is bogus on purpose: this path must never reach the model loader
  const res = await ai.explain({ modelId: 'nope', projectPath: root, item: { name: 'dist', category: 'Build outputs' } })
  assert.strictEqual(res.summary, ai.NOTHING_TO_SUMMARIZE)
  assert.strictEqual(res.facts.safety, SAFETY_LINES['Build outputs'])
  fs.rmSync(root, { recursive: true, force: true })
})

t('plainSummary rescues a wrong "nothing to summarize" from a weak model', async () => {
  // description wins when present
  assert.strictEqual(
    ai.plainSummary({ description: 'A storefront for small bakeries.', readme: '# Shoply' }),
    'A storefront for small bakeries.'
  )
  // otherwise the first real README line, skipping headings, badges and code fences
  assert.strictEqual(
    ai.plainSummary({
      description: '',
      readme: '# Shoply\n\n![badge](x.svg)\n\nOrder management for neighbourhood bakeries.\n'
    }),
    'Order management for neighbourhood bakeries.'
  )
  assert.strictEqual(ai.plainSummary({ description: '', readme: '# Title\n' }), ai.NOTHING_TO_SUMMARIZE)
})

t('GitHub placeholder names are not used as context', async () => {
  assert.ok(ai.looksPlaceholder('turbo-octo-dollop'))
  assert.ok(ai.looksPlaceholder('cautious-broccoli-spoon'))
  assert.ok(!ai.looksPlaceholder('devbroom'))
  assert.ok(!ai.looksPlaceholder('my-app'))

  const root = tmp({
    'package.json': { name: 'turbo-octo-dollop', description: 'Parses invoices.' },
    'README.md': 'Invoice parser.'
  })
  const ctx = await ai.summaryContext(root)
  assert.doesNotMatch(ctx.text, /turbo-octo-dollop/, 'placeholder name must not reach the model')
  fs.rmSync(root, { recursive: true, force: true })
})
