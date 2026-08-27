// Optional, fully offline project explainer. Nothing here runs unless the user downloads a model.
//
// Split of responsibility: FACTS are computed here from the project's own files and are always
// correct. The model only ever writes a 1-2 sentence summary of what the project is — it is never
// asked about folders, safety, or recoverability.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { SAFETY_LINES } = require('./scanner')

// Sizes are the real Content-Length of each GGUF, checked against Hugging Face.
// All tiers are Qwen2.5 (Apache-2.0) on purpose: no per-model attribution requirements. If you ever
// swap one for a Llama model, CREDITS.md must carry the "Built with Llama" notice.
const MODELS = [
  {
    id: 'tiny',
    name: 'Tiny (fastest)',
    about: 'Qwen2.5-0.5B-Instruct, Q4_K_M',
    hw: 'Runs on any PC · 4 GB+ RAM · no GPU needed',
    bytes: 491_000_000,
    file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf'
  },
  {
    id: 'balanced',
    name: 'Balanced',
    about: 'Qwen2.5-1.5B-Instruct, Q4_K_M',
    hw: '8 GB+ RAM · CPU is fine · slightly slower on older CPUs',
    bytes: 1_117_000_000,
    file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf'
  },
  {
    id: 'recommended',
    name: 'Recommended',
    tag: 'Best answers',
    about: 'Qwen2.5-3B-Instruct, Q4_K_M',
    hw: '16 GB RAM best (8 GB works) · much faster with a GPU',
    bytes: 2_105_000_000,
    file: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf'
  }
]

let modelsDir
const setModelsDir = (dir) => {
  modelsDir = dir
  fs.mkdirSync(dir, { recursive: true })
}
const modelPath = (m) => path.join(modelsDir, m.file)

function list() {
  return MODELS.map((m) => {
    let downloaded = false
    let onDisk = 0
    try {
      onDisk = fs.statSync(modelPath(m)).size
      downloaded = onDisk > 0
    } catch {}
    return { ...m, downloaded, onDisk }
  })
}

let aborter
const cancelDownload = () => aborter?.abort()

/** Streams a GGUF to the user-data folder. onProgress({ received, total }). */
async function download(id, onProgress) {
  const model = MODELS.find((m) => m.id === id)
  if (!model) throw new Error('Unknown model: ' + id)
  const dest = modelPath(model)
  const tmp = dest + '.part'
  aborter = new AbortController()

  const res = await fetch(model.url, { redirect: 'follow', signal: aborter.signal })
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length')) || model.bytes

  const out = fs.createWriteStream(tmp)
  let received = 0
  let last = 0
  try {
    for await (const chunk of res.body) {
      received += chunk.length
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
      const now = Date.now()
      if (now - last > 120) {
        last = now
        onProgress && onProgress({ received, total })
      }
    }
    await new Promise((r) => out.end(r))
    await fsp.rename(tmp, dest)
  } catch (err) {
    out.destroy()
    await fsp.rm(tmp, { force: true })
    throw err.name === 'AbortError' ? new Error('Download cancelled') : err
  } finally {
    aborter = null
  }
  onProgress && onProgress({ received: total, total })
  return { ok: true }
}

async function remove(id) {
  const model = MODELS.find((m) => m.id === id)
  if (!model) return
  if (loaded?.id === id) await unload()
  await fsp.rm(modelPath(model), { force: true })
}

// ---------- facts (no model involved) ----------
// Dependency name -> what a human calls it. Only entries worth showing; generic utilities are noise.
const TECH = {
  react: 'React',
  'react-native': 'React Native',
  next: 'Next.js',
  nuxt: 'Nuxt',
  vue: 'Vue',
  svelte: 'Svelte',
  '@sveltejs/kit': 'SvelteKit',
  '@angular/core': 'Angular',
  astro: 'Astro',
  'solid-js': 'Solid',
  electron: 'Electron',
  vite: 'Vite',
  webpack: 'webpack',
  rollup: 'Rollup',
  parcel: 'Parcel',
  esbuild: 'esbuild',
  typescript: 'TypeScript',
  tailwindcss: 'Tailwind CSS',
  sass: 'Sass',
  'styled-components': 'styled-components',
  express: 'Express',
  fastify: 'Fastify',
  koa: 'Koa',
  '@nestjs/core': 'NestJS',
  'socket.io': 'Socket.IO',
  graphql: 'GraphQL',
  mongoose: 'MongoDB (Mongoose)',
  mongodb: 'MongoDB',
  pg: 'PostgreSQL',
  postgres: 'PostgreSQL',
  mysql2: 'MySQL',
  '@prisma/client': 'Prisma',
  prisma: 'Prisma',
  sequelize: 'Sequelize',
  'better-sqlite3': 'SQLite',
  redis: 'Redis',
  jest: 'Jest',
  vitest: 'Vitest',
  playwright: 'Playwright',
  '@playwright/test': 'Playwright',
  cypress: 'Cypress',
  eslint: 'ESLint',
  d3: 'D3',
  recharts: 'Recharts',
  three: 'three.js',
  openai: 'OpenAI API',
  '@anthropic-ai/sdk': 'Anthropic API',
  langchain: 'LangChain'
}

// Non-Node projects, detected by a marker file in the project root.
const MARKERS = [
  ['requirements.txt', 'Python project'],
  ['pyproject.toml', 'Python project'],
  ['Pipfile', 'Python project'],
  ['go.mod', 'Go project'],
  ['Cargo.toml', 'Rust project'],
  ['pom.xml', 'Java project (Maven)'],
  ['build.gradle', 'Java/Kotlin project (Gradle)'],
  ['build.gradle.kts', 'Java/Kotlin project (Gradle)'],
  ['Gemfile', 'Ruby project'],
  ['composer.json', 'PHP project'],
  ['pubspec.yaml', 'Dart/Flutter project'],
  ['CMakeLists.txt', 'C/C++ project (CMake)']
]

const readJson = async (p) => {
  try {
    return JSON.parse(await fsp.readFile(p, 'utf8'))
  } catch {
    return null
  }
}

const readFirst = async (dir, names, limit) => {
  for (const name of names) {
    try {
      const text = (await fsp.readFile(path.join(dir, name), 'utf8')).trim()
      if (text) return limit && text.length > limit ? text.slice(0, limit) + '…' : text
    } catch {}
  }
  return ''
}

/**
 * GitHub's "suggest a name" gives repos three random dictionary words (turbo-octo-dollop).
 * Such a name says nothing about the project, so it must not be fed to the model as context.
 */
const looksPlaceholder = (name = '') =>
  /^[a-z]+-[a-z]+-[a-z]+$/.test(name) && !/\d/.test(name) && name.length > 11

/** Everything the panel shows that must always be right. Computed from the project's own files. */
async function facts(projectPath, item) {
  const pkg = await readJson(path.join(projectPath, 'package.json'))
  const deps = pkg ? Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }) : []
  const tech = [...new Set(deps.map((d) => TECH[d]).filter(Boolean))]

  let type = null
  if (pkg) {
    type = 'Node.js project'
    if (!tech.length) tech.push('Node.js')
  } else {
    for (const [marker, label] of MARKERS) {
      if (fs.existsSync(path.join(projectPath, marker))) {
        type = label
        break
      }
    }
  }

  return {
    type: type ?? 'Unknown project type.',
    tech,
    // The safety line is fixed app text keyed off our own rule category — never model output.
    safety: item ? (SAFETY_LINES[item.category] ?? 'Custom rule — review before deleting.') : null,
    itemName: item?.name ?? null
  }
}

// ---------- inference ----------
let loaded // { id, llama, model, context }

async function unload() {
  try {
    await loaded?.context?.dispose()
    await loaded?.model?.dispose()
  } catch {}
  loaded = null
}

const SYSTEM_PROMPT =
  "You summarize what a software project is, in 1 to 2 short sentences, using ONLY the text provided. " +
  'Be specific and factual. Do not guess. Do not add generic filler. Do not mention deleting, folders, ' +
  'caches, or whether anything is recoverable. If the provided text has no real description or README ' +
  "content, reply with exactly this and nothing else: 'No description or README found, so there's " +
  "nothing reliable to summarize about this project.'"

const NOTHING_TO_SUMMARIZE =
  "No description or README found, so there's nothing reliable to summarize about this project."

async function getSession(id) {
  const model = MODELS.find((m) => m.id === id)
  if (!model) throw new Error('No model selected. Download one in Settings first.')
  if (!fs.existsSync(modelPath(model))) throw new Error(`"${model.name}" is not downloaded yet.`)

  const { getLlama, LlamaChatSession } = await import('node-llama-cpp')
  if (loaded?.id !== id) {
    await unload()
    const llama = await getLlama()
    const m = await llama.loadModel({ modelPath: modelPath(model) })
    const context = await m.createContext({ contextSize: 2048 })
    loaded = { id, llama, model: m, context }
  }
  return new LlamaChatSession({ contextSequence: loaded.context.getSequence(), systemPrompt: SYSTEM_PROMPT })
}

/** The only text the model ever sees: description, README, dependency names, script names. */
async function summaryContext(projectPath) {
  const pkg = await readJson(path.join(projectPath, 'package.json'))
  const description = (pkg?.description ?? '').trim()
  const readme = await readFirst(projectPath, ['README.md', 'readme.md', 'README', 'README.txt'], 1500)
  const deps = pkg ? Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }) : []
  const scripts = pkg ? Object.keys(pkg.scripts ?? {}) : []
  const name = pkg?.name && !looksPlaceholder(pkg.name) ? pkg.name : ''

  const lines = []
  if (name) lines.push(`Package name: ${name}`)
  lines.push(`Description: ${description || '(none)'}`)
  lines.push(`README:\n${readme || '(none)'}`)
  if (deps.length) lines.push(`Dependencies: ${deps.slice(0, 40).join(', ')}`)
  if (scripts.length) lines.push(`Scripts: ${scripts.join(', ')}`)

  return {
    text: lines.join('\n\n'),
    hasContent: Boolean(description || readme),
    description,
    readme
  }
}

/**
 * A summary taken verbatim from the project's own words. Used when the model claims there is
 * nothing to summarize even though we already established there is — small models latch onto the
 * fallback sentence in the system prompt, and a wrong answer is worse than a plain one.
 */
function plainSummary({ description, readme }) {
  if (description) return description
  const skip = /^(#|!\[|\[!|```|\||>|-{3,}|={3,})/
  const line = readme
    .split('\n')
    .map((s) => s.trim())
    .find((s) => s.length > 20 && !skip.test(s))
  if (!line) return NOTHING_TO_SUMMARIZE
  return line.length > 240 ? line.slice(0, 240) + '…' : line
}

/**
 * Returns { facts, summary }. The summary is the model's only job; when there is nothing real to
 * read we skip the model entirely rather than inviting it to invent something.
 */
async function explain({ modelId, projectPath, item }, onToken) {
  const f = await facts(projectPath, item)
  const ctx = await summaryContext(projectPath)

  if (!ctx.hasContent) {
    onToken && onToken(NOTHING_TO_SUMMARIZE)
    return { facts: f, summary: NOTHING_TO_SUMMARIZE }
  }

  const session = await getSession(modelId)
  const raw = await session.prompt(
    // We already know real content exists, so say so — otherwise weak models reach for the
    // "nothing to summarize" escape hatch even with a full README in front of them.
    `Summarize this project in 1-2 sentences. The text below contains a real description and/or ` +
      `README, so summarize it.\n\n${ctx.text}`,
    {
      maxTokens: 120,
      temperature: 0.2,
      topP: 0.9,
      trimWhitespaceSuffix: true,
      customStopTriggers: ['\n\n', '```'], // stop before it starts rambling past the summary
      onTextChunk: (t) => onToken && onToken(t)
    }
  )

  const summary = raw.trim().replace(/\*\*|`/g, '') // the panel is plain text, not markdown
  // Guard: this project demonstrably has content, so that answer cannot be right.
  if (!summary || /nothing reliable to summarize/i.test(summary))
    return { facts: f, summary: plainSummary(ctx) }
  return { facts: f, summary }
}

module.exports = {
  MODELS,
  setModelsDir,
  list,
  download,
  cancelDownload,
  remove,
  facts,
  explain,
  unload,
  looksPlaceholder,
  summaryContext,
  plainSummary,
  NOTHING_TO_SUMMARIZE
}
