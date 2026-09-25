// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { focusXtermUnlessCovered, mayRestoreFocus, useMdModeFocus, type FocusableTerm } from './useMdModeFocus'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A stand-in for xterm: its helper textarea is what holds DOM focus while the terminal types. */
function fakeTerm(): FocusableTerm & { calls: string[] } {
  const textarea = document.createElement('textarea')
  document.body.appendChild(textarea)
  const calls: string[] = []
  return {
    textarea,
    calls,
    blur: () => {
      calls.push('blur')
      textarea.blur()
    },
    focus: () => {
      calls.push('focus')
      textarea.focus()
    }
  }
}

let host: HTMLDivElement
let root: Root
let term: ReturnType<typeof fakeTerm> | null
/** The node root: the terminal's textarea lives inside it, like a real `.term-node`. */
let nodeRoot: HTMLDivElement

function Harness({ mdMode }: { mdMode: boolean }) {
  useMdModeFocus(mdMode, () => term, () => nodeRoot)
  return null
}

const render = (mdMode: boolean) => act(() => root.render(<Harness mdMode={mdMode} />))

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  nodeRoot = document.createElement('div')
  document.body.appendChild(nodeRoot)
  term = fakeTerm()
  nodeRoot.appendChild(term.textarea!)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
})

describe('useMdModeFocus', () => {
  it('blurs the terminal when the view opens, so keystrokes stop reaching the hidden pane', () => {
    render(false)
    term!.focus()
    render(true)
    expect(document.activeElement).not.toBe(term!.textarea)
    expect(term!.calls).toContain('blur')
  })

  it('gives focus back on exit when the terminal had it on entry', () => {
    render(false)
    term!.focus()
    render(true)
    term!.calls.length = 0
    render(false)
    expect(term!.calls).toEqual(['focus'])
    expect(document.activeElement).toBe(term!.textarea)
  })

  it('does NOT steal focus on exit when the terminal did not have it on entry', () => {
    const other = document.createElement('input')
    document.body.appendChild(other)
    render(false)
    other.focus()
    render(true)
    render(false)
    expect(term!.calls).not.toContain('focus')
    expect(document.activeElement).toBe(other)
  })

  it('had focus on entry, but the user focused an input elsewhere meanwhile → no focus()', () => {
    render(false)
    term!.focus()
    render(true)
    const elsewhere = document.createElement('input')
    document.body.appendChild(elsewhere)
    elsewhere.focus()
    term!.calls.length = 0
    render(false)
    expect(term!.calls).not.toContain('focus')
    expect(document.activeElement).toBe(elsewhere)
  })

  it('restores when focus meanwhile stayed inside this node (e.g. the view\'s own controls)', () => {
    render(false)
    term!.focus()
    render(true)
    const insideNode = document.createElement('button')
    nodeRoot.appendChild(insideNode)
    insideNode.focus()
    term!.calls.length = 0
    render(false)
    expect(term!.calls).toEqual(['focus'])
  })

  it('never focuses on first mount, whatever the mode', () => {
    render(false)
    expect(term!.calls).toEqual([])
  })

  it('tolerates a terminal that does not exist (released / not yet spawned)', () => {
    term = null
    render(false)
    render(true)
    render(false)
  })
})

describe('mayRestoreFocus', () => {
  const body = document.createElement('body')
  const nodeRoot = document.createElement('div')
  const inside = document.createElement('span')
  nodeRoot.appendChild(inside)
  const outside = document.createElement('input')

  it('allows it when focus is nowhere or inside the node', () => {
    expect(mayRestoreFocus(null, nodeRoot, body)).toBe(true)
    expect(mayRestoreFocus(body, nodeRoot, body)).toBe(true)
    expect(mayRestoreFocus(inside, nodeRoot, body)).toBe(true)
  })

  it('refuses when focus is somewhere else, or the node root is unknown', () => {
    expect(mayRestoreFocus(outside, nodeRoot, body)).toBe(false)
    expect(mayRestoreFocus(inside, null, body)).toBe(false)
  })
})

describe('focusXtermUnlessCovered', () => {
  it('focuses only while the ⌘M view is not covering the terminal', () => {
    let n = 0
    const t: FocusableTerm = { blur: () => {}, focus: () => void n++ }
    focusXtermUnlessCovered(t, true)
    expect(n).toBe(0)
    focusXtermUnlessCovered(t, false)
    expect(n).toBe(1)
    focusXtermUnlessCovered(null, false)
  })

  it('is what every TerminalNode "take the keyboard" path calls (no bare xterm focus left)', () => {
    // Source pin: the dwell and enterNow are closures deep in a 6000-line component that cannot
    // be mounted here; a bare `termRef.current?.focus()` reintroduced there would route
    // keystrokes into the hidden pane again with every unit test still green.
    const src = readFileSync(resolve(__dirname, '../nodes/TerminalNode.tsx'), 'utf8').replace(/\r\n/g, '\n')
    expect(src).not.toMatch(/termRef\.current\?\.focus\(\)/)
    expect(src.match(/focusXtermUnlessCovered\(termRef\.current, mdModeRef\.current\)/g)?.length).toBe(2)
  })
})
