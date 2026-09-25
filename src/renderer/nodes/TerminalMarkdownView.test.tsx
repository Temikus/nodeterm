// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { TerminalMarkdownView } from './TerminalMarkdownView'

// Standalone harness — react-dom only, no testing-library (same shape as useDiscardWhenHidden).
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface Deferred {
  resolve: (text: string) => void
  reject: (err: unknown) => void
}

let host: HTMLDivElement
let root: Root
let pending: Deferred[]
let capture: ReturnType<typeof vi.fn<(id: string) => Promise<string>>>

// Warm the lazily imported renderer once, so each test's `settle()` only has to wait for its own
// promises and not for vite to transform marked + DOMPurify on first use.
beforeAll(async () => {
  await import('../lib/terminalOutputMarkdown')
})

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  pending = []
  capture = vi.fn(
    () =>
      new Promise<string>((resolve, reject) => {
        pending.push({ resolve, reject })
      })
  )
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

/** Let the capture promise + the lazy `import()` of the renderer settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

function mount(): void {
  act(() => root.render(<TerminalMarkdownView nodeId="n1" capture={capture} hint="⌘M to exit" />))
}

const content = () => host.querySelector('.term-md__content') as HTMLElement
const refresh = () => host.querySelector('.term-md__refresh') as HTMLButtonElement

describe('TerminalMarkdownView', () => {
  it('captures the node on mount, shows Capturing…, then the rendered output', async () => {
    mount()
    expect(capture).toHaveBeenCalledWith('n1')
    expect(content().textContent).toBe('Capturing…')
    expect(refresh().disabled).toBe(true)
    pending[0].resolve('$ echo <stdin>\nline two\n\n\n')
    await settle()
    expect(content().innerHTML).toContain('&lt;stdin&gt;')
    expect(content().innerHTML).toContain('<br>')
    expect(refresh().disabled).toBe(false)
    expect(host.querySelector('.term-md__hint')?.textContent).toBe('⌘M to exit')
  })

  it("says so when the capture is empty — '' is an answer, not a blank page", async () => {
    mount()
    pending[0].resolve('\n\n  \n')
    await settle()
    expect(content().textContent).toBe('Nothing captured from this terminal.')
  })

  it('reports a failed capture as a failure, never as empty output', async () => {
    mount()
    pending[0].reject(new Error('ssh down'))
    await settle()
    expect(content().textContent).toBe('Could not capture this terminal’s output.')
  })

  it('↻ re-captures, keeping the old output visible meanwhile', async () => {
    mount()
    pending[0].resolve('first')
    await settle()
    act(() => refresh().click())
    expect(capture).toHaveBeenCalledTimes(2)
    expect(content().textContent).toContain('first')
    expect(host.querySelector('.term-md__bar')?.textContent).toContain('Capturing…')
    pending[1].resolve('second')
    await settle()
    expect(content().textContent).toContain('second')
  })

  it('drops an older answer that lands after a newer one', async () => {
    mount()
    pending[0].resolve('first')
    await settle()
    act(() => refresh().click()) // request 2
    // Re-enable by hand is not possible while capturing, so drive a third request by remounting
    // the view on a new node id — the same token path.
    act(() => root.render(<TerminalMarkdownView nodeId="n2" capture={capture} hint="" />))
    expect(capture).toHaveBeenLastCalledWith('n2')
    pending[2].resolve('newest')
    await settle()
    pending[1].resolve('stale')
    await settle()
    expect(content().textContent).toContain('newest')
    expect(content().textContent).not.toContain('stale')
  })

  it('ignores an answer that arrives after unmount', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    mount()
    act(() => root.unmount())
    pending[0].resolve('late')
    await settle()
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
    root = createRoot(host) // afterEach unmounts again
  })

  it('renders only the last 5000 lines and says how many were cut', async () => {
    mount()
    pending[0].resolve(Array.from({ length: 5003 }, (_, i) => `row${i + 1}`).join('\n'))
    await settle()
    const text = content().textContent ?? ''
    expect(text).not.toContain('row3\n')
    expect(text.startsWith('row4')).toBe(true)
    expect(text).toContain('row5003')
    expect(host.querySelector('.term-md__bar')?.textContent).toContain('Last 5,000 lines (3 older not shown)')
  })

  it('opens scrolled to the bottom (latest output), and again after a refresh', async () => {
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 900 })
    try {
      mount()
      pending[0].resolve('a\nb')
      await settle()
      expect(content().scrollTop).toBe(900)
      content().scrollTop = 0
      act(() => refresh().click())
      pending[1].resolve('a\nb')
      await settle()
      expect(content().scrollTop).toBe(900)
    } finally {
      if (desc) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', desc)
    }
  })
})
