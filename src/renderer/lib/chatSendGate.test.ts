import { describe, expect, it } from 'vitest'
import { canSendFromChat, chatComposerPlaceholder } from './chatSendGate'

describe('canSendFromChat', () => {
  it('allows a finished turn and an unknown state (no hook knowledge keeps the historical behavior)', () => {
    expect(canSendFromChat('done')).toBe(true)
    expect(canSendFromChat(undefined)).toBe(true)
  })

  it('refuses while the agent is working', () => {
    expect(canSendFromChat('working')).toBe(false)
  })

  it('refuses while a TUI dialog is up: Enter would answer it', () => {
    // PermissionRequest / AskUserQuestion normalize to `waiting`, a permission Notification to
    // `blocked` — both are select dialogs where sendText's trailing Enter confirms the highlight.
    expect(canSendFromChat('waiting')).toBe(false)
    expect(canSendFromChat('blocked')).toBe(false)
  })
})

describe('chatComposerPlaceholder', () => {
  it('keeps the historical copy for a sendable state', () => {
    expect(chatComposerPlaceholder({ readonly: false, state: 'done', chip: '⌘M' })).toBe(
      'Message Claude…  (Enter to send)'
    )
    expect(chatComposerPlaceholder({ readonly: false, state: undefined, chip: '' })).toBe(
      'Message Claude…  (Enter to send)'
    )
  })

  it('keeps the working copy', () => {
    expect(chatComposerPlaceholder({ readonly: false, state: 'working', chip: '⌘M' })).toBe('Claude is working…')
  })

  it('points a dialog back at the terminal through the bound chord', () => {
    for (const state of ['waiting', 'blocked'] as const) {
      expect(chatComposerPlaceholder({ readonly: false, state, chip: '⌘M' })).toBe(
        'Claude is waiting for an answer in the terminal — press ⌘M to answer there'
      )
    }
  })

  it('never promises a chord that is unbound', () => {
    const text = chatComposerPlaceholder({ readonly: false, state: 'waiting', chip: '' })
    expect(text).toBe('Claude is waiting for an answer in the terminal — switch back to the terminal to answer')
    expect(text).not.toMatch(/press/)
  })

  it('a write failure wins over every state', () => {
    expect(chatComposerPlaceholder({ readonly: true, state: 'waiting', chip: '⌘M' })).toBe(
      "Can't write to this session"
    )
  })
})
