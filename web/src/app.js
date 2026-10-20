import { Marp } from '@marp-team/marp-core'
import mermaid from 'mermaid'

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })

const $ = (id) => document.getElementById(id)
const editor = $('editor'), preview = $('preview'), statusEl = $('status')
const LINE_H = 21

const marp = new Marp({ html: false })
const defaultFence = marp.markdown.renderer.rules.fence
marp.markdown.renderer.rules.fence = (tokens, idx, ...rest) => {
  const t = tokens[idx]
  if (t.info.trim() === 'mermaid') {
    return `<pre class="mermaid">${marp.markdown.utils.escapeHtml(t.content)}</pre>\n`
  }
  return defaultFence(tokens, idx, ...rest)
}

let customCss = ''
const styleTag = document.createElement('style')
document.head.appendChild(styleTag)

const svgCache = new Map()
let mermaidSeq = 0
async function renderMermaid() {
  for (const el of preview.querySelectorAll('pre.mermaid')) {
    const src = el.textContent
    if (!svgCache.has(src)) {
      try {
        const { svg } = await mermaid.render('m' + mermaidSeq++, src)
        svgCache.set(src, svg)
      } catch (e) {
        document.querySelectorAll('[id^=dm]').forEach((n) => n.remove())
        svgCache.set(src, null)
      }
    }
    const svg = svgCache.get(src)
    if (svg) el.innerHTML = svg
    else el.classList.add('error')
  }
}

let renderToken = 0
function render() {
  const { html, css } = marp.render(editor.value)
  styleTag.textContent = css + '\n' + customCss
  const keep = preview.scrollTop
  preview.innerHTML = html
  preview.scrollTop = keep
  const tok = ++renderToken
  renderMermaid().then(() => { if (tok === renderToken) preview.scrollTop = keep })
}

// ---- scroll sync ----
function slideStarts(text) {
  const lines = text.split('\n')
  const starts = [0]
  let i = 0
  if (lines[0] && lines[0].trim() === '---') {
    for (let j = 1; j < lines.length; j++) if (lines[j].trim() === '---') { i = j + 1; break }
    if (i) starts[0] = i
  }
  let fence = null
  for (let j = i; j < lines.length; j++) {
    const m = lines[j].match(/^\s*(```+|~~~+)/)
    if (m) { fence = fence ? (lines[j].trim().startsWith(fence) ? null : fence) : m[1]; continue }
    if (!fence && /^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[j]) && j > starts[0]) starts.push(j + 1)
  }
  starts.push(lines.length + 1)
  return starts
}

let lock = null
function withLock(who, fn) { lock = who; fn(); clearTimeout(withLock.t); withLock.t = setTimeout(() => (lock = null), 120) }

editor.addEventListener('scroll', () => {
  if (lock === 'preview') return
  const starts = slideStarts(editor.value)
  const line = editor.scrollTop / LINE_H
  let s = 0
  while (s < starts.length - 2 && starts[s + 1] <= line) s++
  const frac = Math.min(1, Math.max(0, (line - starts[s]) / Math.max(1, starts[s + 1] - starts[s])))
  const slides = preview.querySelectorAll('svg[data-marpit-svg]')
  const el = slides[s]
  if (!el) return
  withLock('editor', () => { preview.scrollTop = el.offsetTop - preview.offsetTop + frac * el.offsetHeight })
})

preview.addEventListener('scroll', () => {
  if (lock === 'editor') return
  const slides = [...preview.querySelectorAll('svg[data-marpit-svg]')]
  if (!slides.length) return
  const y = preview.scrollTop + preview.offsetTop
  let s = 0
  while (s < slides.length - 1 && slides[s + 1].offsetTop <= y) s++
  const el = slides[s]
  const frac = Math.min(1, Math.max(0, (y - el.offsetTop) / el.offsetHeight))
  const starts = slideStarts(editor.value)
  const line = starts[s] + frac * (starts[s + 1] - starts[s])
  withLock('preview', () => { editor.scrollTop = line * LINE_H })
})

// ---- server I/O ----
function setStatus(t) { statusEl.textContent = t }
async function api(method, path, body) {
  const r = await fetch('/api' + path, { method, body })
  if (!r.ok) throw new Error(await r.text())
  return method === 'GET' ? r : null
}
async function fill(sel, path, first) {
  const names = await (await api('GET', path + '/')).json()
  const cur = sel.value
  sel.innerHTML = ''
  sel.add(new Option(first, ''))
  names.forEach((n) => sel.add(new Option(n, n)))
  sel.value = names.includes(cur) ? cur : ''
}
const enc = encodeURIComponent

$('save').onclick = async () => {
  try { await api('PUT', '/presentations/' + enc($('name').value), editor.value); setStatus('saved'); fill($('load'), '/presentations', 'Load…') }
  catch (e) { setStatus('save failed: ' + e.message) }
}
$('load').onchange = async (e) => {
  const n = e.target.value
  if (!n) return
  editor.value = await (await api('GET', '/presentations/' + enc(n))).text()
  $('name').value = n
  e.target.value = ''
  render(); setStatus('loaded ' + n)
}
$('style').onchange = async (e) => {
  const n = e.target.value
  customCss = n ? await (await api('GET', '/styles/' + enc(n))).text() : ''
  localStorage.setItem('style', n)
  render()
}
$('editStyle').onclick = async () => {
  let n = $('style').value || prompt('New style name:')
  if (!n) return
  let css = ''
  try { css = await (await api('GET', '/styles/' + enc(n))).text() } catch {}
  const next = prompt(`CSS for style "${n}" (empty text deletes it):`, css)
  if (next === null) return
  try {
    if (next === '') await api('DELETE', '/styles/' + enc(n))
    else await api('PUT', '/styles/' + enc(n), next)
    await fill($('style'), '/styles', '(default style)')
    $('style').value = next === '' ? '' : n
    $('style').onchange({ target: $('style') })
  } catch (e) { setStatus('style failed: ' + e.message) }
}
$('pdf').onclick = () => window.print()

editor.addEventListener('input', () => { clearTimeout(editor.t); editor.t = setTimeout(render, 150) })
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  ') }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); $('save').click() }
})

editor.value = `---
marp: true
---

# Hello Marp

Edit on the left, preview on the right.

---

## Mermaid

\`\`\`mermaid
graph LR
  A --> B --> C
\`\`\`
`
render()
fill($('load'), '/presentations', 'Load…').catch(() => {})
fill($('style'), '/styles', '(default style)').then(() => {
  const s = localStorage.getItem('style')
  if (s && [...$('style').options].some((o) => o.value === s)) { $('style').value = s; $('style').onchange({ target: $('style') }) }
}).catch(() => {})
