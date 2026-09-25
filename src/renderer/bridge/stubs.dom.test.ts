// @vitest-environment jsdom
//
// The Server Edition's ⌘M path end to end through the REAL stub surface: a keydown dispatched on
// the browser `window` must reach an `onMarkdownToggle` subscriber, following the user's live
// `node.toggleMarkdown` binding from the settings store. (jsdom reports a non-mac platform, so the
// default `Cmd+M` resolves to Ctrl+M here.)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useSettings } from '../state/settings'
import { buildStubApi } from './stubs'

const press = (init: KeyboardEventInit) => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  window.dispatchEvent(e)
  return e
}

beforeEach(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS } }))

describe('bridge onMarkdownToggle (browser)', () => {
  it('fires on the default chord and claims it; stops after unsubscribe', () => {
    const s = buildStubApi()
    const cb = vi.fn()
    const un = s.onMarkdownToggle(cb)
    const e = press({ key: 'm', ctrlKey: true })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(e.defaultPrevented).toBe(true)
    un()
    press({ key: 'm', ctrlKey: true })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('follows a remap from the settings store', () => {
    useSettings.setState({
      settings: { ...DEFAULT_SETTINGS, keybindings: { 'node.toggleMarkdown': ['Cmd+Alt+M'] } }
    })
    const s = buildStubApi()
    const cb = vi.fn()
    const un = s.onMarkdownToggle(cb)
    press({ key: 'm', ctrlKey: true })
    expect(cb).not.toHaveBeenCalled()
    press({ key: 'm', ctrlKey: true, altKey: true })
    expect(cb).toHaveBeenCalledTimes(1)
    un()
  })
})
