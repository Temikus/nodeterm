// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { marked } from 'marked'
import { renderTerminalOutput } from './terminalOutputMarkdown'
import { renderMarkdown } from './markdown'

/** Visible text of the rendered HTML, the way a user reads it. */
function textOf(html: string): string {
  const el = document.createElement('div')
  el.innerHTML = html
  return el.textContent ?? ''
}

describe('renderTerminalOutput', () => {
  it('keeps consecutive output lines apart (ls -l must not become one line)', () => {
    const out = 'total 8\n-rw-r--r-- 1 u u 10 a.txt\n-rw-r--r-- 1 u u 20 b.txt'
    const html = renderTerminalOutput(out)
    expect(html.match(/<br>/g)?.length).toBe(2)
    expect(textOf(html)).toContain('a.txt')
  })

  it('shows raw-HTML-looking output as text instead of parsing and stripping it', () => {
    const html = renderTerminalOutput('$ echo <stdin>\n<stdin>')
    expect(textOf(html)).toMatch(/^\$ echo <stdin>\n?<stdin>\n?$/)
    expect(html).toContain('&lt;stdin&gt;')
  })

  it('shows a block of raw HTML as text, lines kept', () => {
    const html = renderTerminalOutput('<div class="x">\nhello\n</div>')
    expect(html).not.toMatch(/<div class="x">/)
    expect(textOf(html)).toContain('<div class="x">')
    expect(textOf(html)).toContain('</div>')
  })

  it('never lets an escaped tag execute — script and handlers are text, not markup', () => {
    const html = renderTerminalOutput('<img src=x onerror=alert(1)> <script>alert(1)</script>')
    const el = document.createElement('div')
    el.innerHTML = html
    expect(el.querySelector('img, script')).toBeNull()
    expect(el.textContent).toContain('<script>')
  })

  it('does not double-escape inside code spans and fenced blocks', () => {
    const html = renderTerminalOutput('run `a <b> c`\n\n```\nx < y && <tag>\n```')
    expect(textOf(html)).toContain('a <b> c')
    expect(textOf(html)).toContain('x < y && <tag>')
    expect(html).not.toContain('&amp;lt;')
  })

  it('trims the trailing blank lines and trailing spaces capture-pane pads with', () => {
    const html = renderTerminalOutput('$ ls   \nfile  \n\n\n   \n\n')
    expect(html).toBe(renderTerminalOutput('$ ls\nfile'))
    expect(html.trimEnd().endsWith('file</p>')).toBe(true)
  })

  it('still sanitizes (markdown links with javascript: urls lose their href)', () => {
    const html = renderTerminalOutput('[x](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
  })

  it('renders empty input as empty', () => {
    expect(renderTerminalOutput('')).toBe('')
    expect(renderTerminalOutput('\n\n  \n')).toBe('')
  })

  it('does not mutate the shared marked config the other callers use', () => {
    renderTerminalOutput('a\nb <x>')
    expect(marked.defaults.breaks).toBe(false)
    expect(renderMarkdown('a\nb')).toBe('<p>a\nb</p>\n')
    expect(renderMarkdown('<b>x</b>')).toBe('<p><b>x</b></p>\n')
  })
})
