// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { useMdModeFocus, type FocusableTerm } from './useMdModeFocus'

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

function Harness({ mdMode }: { mdMode: boolean }) {
  useMdModeFocus(mdMode, () => term)
  return null
}

const render = (mdMode: boolean) => act(() => root.render(<Harness mdMode={mdMode} />))

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  term = fakeTerm()
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
