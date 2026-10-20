import { Marp } from '@marp-team/marp-core'
import mermaid from 'mermaid'

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })

const $ = (id) => document.getElementById(id)
const editor = $('editor'), preview = $('preview'), statusEl = $('status')

// Slides render inside shadow roots so presentation/custom CSS can't leak into the app UI.
const BASE_CSS = `
:host{display:block}
.box svg[data-marpit-svg]{display:block;width:100%;height:auto;margin:0 0 16px;background:#fff;box-shadow:0 4px 16px #0008;border-radius:2px}
.box pre.mermaid{background:none;text-align:center}
.stage svg[data-marpit-svg]{display:none;width:100vw;height:100vh;margin:0;box-shadow:none;border-radius:0}
.stage svg[data-marpit-svg].current{display:block}
@media print{.box svg[data-marpit-svg]{width:1280px;height:720px;margin:0;box-shadow:none;break-after:page;border-radius:0}}
`
function shadowBox(host, cls) {
  const root = host.attachShadow({ mode: 'open' })
  const base = document.createElement('style'); base.textContent = BASE_CSS
  const user = document.createElement('style')
  const box = document.createElement('div'); box.className = cls
  root.append(base, user, box)
  return { box, user }
}
const previewShadow = shadowBox(preview, 'box')
const previewBox = previewShadow.box
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
const styleTag = previewShadow.user

const svgCache = new Map()
let mermaidSeq = 0
async function renderMermaid() {
  for (const el of previewBox.querySelectorAll('pre.mermaid')) {
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
  previewBox.innerHTML = html
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
  const slides = previewBox.querySelectorAll('svg[data-marpit-svg]')
  const el = slides[s]
  if (!el) return
  withLock('editor', () => { preview.scrollTop = el.offsetTop - preview.offsetTop + frac * el.offsetHeight })
})

preview.addEventListener('scroll', () => {
  if (lock === 'editor') return
  const slides = [...previewBox.querySelectorAll('svg[data-marpit-svg]')]
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

// ---- syntax highlighting ----
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const span = (c, t) => `<span class="t-${c}">${esc(t)}</span>`

function inline(text) {
  const re = /(`[^`]*`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(!?\[[^\]]*\]\([^)]*\))|(<[^>]+>)|(https?:\/\/[^\s)]+)/g
  let out = '', last = 0, m
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index))
    const c = m[1] ? 'code' : m[2] ? 'b' : m[3] ? 'i' : m[4] ? 'l' : m[5] ? 'q' : 'u'
    out += span(c, m[0])
    last = m.index + m[0].length
  }
  return out + esc(text.slice(last))
}

function highlightMarkdown(text) {
  const lines = text.split('\n')
  let fence = null, front = lines[0] && lines[0].trim() === '---'
  return lines.map((ln, i) => {
    if (front) {
      if (i > 0 && ln.trim() === '---') front = false
      return i === 0 || !front ? span('sep', ln) : span('fm', ln)
    }
    if (fence) {
      if (ln.trim().startsWith(fence)) { fence = null; return span('fence', ln) }
      return span('code', ln)
    }
    let m = ln.match(/^\s*(```+|~~~+)/)
    if (m) { fence = m[1]; return span('fence', ln) }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(ln)) return span('sep', ln)
    if (/^\s{0,3}#{1,6}(\s|$)/.test(ln)) return span('h', ln)
    if (/^\s*<!--.*-->\s*$/.test(ln)) return span('cm', ln)
    if ((m = ln.match(/^(\s*>+\s?)(.*)$/))) return span('q', m[1]) + inline(m[2])
    if ((m = ln.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/))) return span('li', m[1]) + inline(m[2])
    return inline(ln)
  }).join('\n')
}

function highlightCss(text) {
  const re = /(\/\*[\s\S]*?(?:\*\/|$))|(@[\w-]+)|([^{}@;:]*)(\{)|([\w-]+)(\s*:)([^;}]*)/g
  let out = '', last = 0, m
  while ((m = re.exec(text))) {
    if (m[0] === '') { re.lastIndex++; continue }
    out += esc(text.slice(last, m.index))
    if (m[1]) out += span('cm', m[1])
    else if (m[2]) out += span('at', m[2])
    else if (m[4]) out += span('sel', m[3]) + esc('{')
    else out += span('prop', m[5]) + esc(m[6]) + span('val', m[7])
    last = m.index + m[0].length
  }
  return out + esc(text.slice(last))
}

function bindHighlight(ta, pre, fn) {
  const update = () => { pre.innerHTML = fn(ta.value) + '\n '; pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft }
  ta.addEventListener('input', update)
  ta.addEventListener('scroll', () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft })
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  ') }
  })
  return update
}
const updateHl = bindHighlight(editor, $('hl'), highlightMarkdown)
const updateCssHl = bindHighlight($('cssEditor'), $('hlCss'), highlightCss)

// ---- tabs ----
function showTab(style) {
  $('tabSlides').classList.toggle('active', !style)
  $('tabStyle').classList.toggle('active', style)
  $('wrapSlides').hidden = style
  $('wrapStyle').hidden = !style
  $('styleTools').hidden = !style
  ;(style ? $('cssEditor') : editor).focus()
}
$('tabSlides').onclick = () => showTab(false)
$('tabStyle').onclick = () => showTab(true)

$('cssEditor').addEventListener('input', () => {
  customCss = $('cssEditor').value
  localStorage.setItem('customCss', customCss)
  clearTimeout(render.t); render.t = setTimeout(render, 150)
})

// ---- file I/O ----
function setStatus(t) { statusEl.textContent = t }
function download(name, text, type) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
function pickFile(input, cb) {
  input.onchange = async () => {
    const f = input.files[0]
    input.value = ''
    if (f) cb(f.name, await f.text())
  }
  input.click()
}
const baseName = (n) => n.replace(/\.[^.]*$/, '')

$('save').onclick = () => {
  const n = ($('name').value.trim() || 'untitled').replace(/[\\/:*?"<>|]/g, '_')
  download(n + '.md', editor.value, 'text/markdown')
  setStatus('downloaded ' + n + '.md')
}
$('load').onclick = () => pickFile($('file'), (name, text) => {
  editor.value = text
  $('name').value = baseName(name)
  updateHl(); render(); setStatus('loaded ' + name)
})
$('saveCss').onclick = () => download(($('name').value.trim() || 'untitled') + '.css', $('cssEditor').value, 'text/css')
$('loadCss').onclick = () => pickFile($('cssfile'), (name, text) => {
  $('cssEditor').value = text
  $('cssEditor').dispatchEvent(new Event('input'))
  updateCssHl(); setStatus('loaded ' + name)
})
$('pdf').onclick = () => window.print()

// ---- presenter mode ----
const presenter = $('presenter')
const stageShadow = shadowBox($('stage'), 'stage'), stage = stageShadow.box
let slideIdx = 0, hintTimer = null
function showSlide(i) {
  const slides = stage.querySelectorAll('svg[data-marpit-svg]')
  if (!slides.length) return
  slideIdx = Math.max(0, Math.min(slides.length - 1, i))
  slides.forEach((el, k) => el.classList.toggle('current', k === slideIdx))
  $('counter').textContent = (slideIdx + 1) + ' / ' + slides.length
}
function showHint() {
  const h = $('hint')
  h.classList.remove('fade')
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => h.classList.add('fade'), 3500)
}
function startPresenting() {
  stage.innerHTML = previewBox.innerHTML
  presenter.hidden = false
  const slides = [...previewBox.querySelectorAll('svg[data-marpit-svg]')]
  const y = preview.scrollTop + preview.offsetTop
  let s = 0
  while (s < slides.length - 1 && slides[s + 1].offsetTop <= y) s++
  showSlide(s)
  showHint()
}
function stopPresenting() {
  presenter.hidden = true
  stage.innerHTML = ''
  stageShadow.user.textContent = ''
  if (document.fullscreenElement) document.exitFullscreen()
}
$('present').onclick = startPresenting
presenter.addEventListener('mousemove', showHint)
presenter.addEventListener('click', (e) => showSlide(slideIdx + (e.clientX < innerWidth / 4 ? -1 : 1)))
document.addEventListener('keydown', (e) => {
  if (presenter.hidden) return
  const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter']
  const prev = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace']
  if (next.includes(e.key)) showSlide(slideIdx + 1)
  else if (prev.includes(e.key)) showSlide(slideIdx - 1)
  else if (e.key === 'Home') showSlide(0)
  else if (e.key === 'End') showSlide(1e9)
  else if (e.key === 'Escape') stopPresenting()
  else if (e.key === 'f' || e.key === 'F') {
    if (document.fullscreenElement) document.exitFullscreen()
    else presenter.requestFullscreen && presenter.requestFullscreen().catch(() => {})
  } else return
  e.preventDefault()
  showHint()
})

editor.addEventListener('input', () => { clearTimeout(editor.t); editor.t = setTimeout(render, 150) })
editor.addEventListener('keydown', (e) => {
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
customCss = localStorage.getItem('customCss') || ''
$('cssEditor').value = customCss
updateHl(); updateCssHl()
render()
