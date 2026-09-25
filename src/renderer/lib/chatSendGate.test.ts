import { describe, expect, it } from 'vitest'
import { canSendFromChat, chatComposerPlaceholder, chatSendRefusal } from './chatSendGate'

describe('chatSendRefusal / canSendFromChat', () => {
  it('allows a finished turn and an unknown state (no hook knowledge keeps the historical behavior)', () => {
    expect(chatSendRefusal({ state: 'done' })).toBeNull()
    expect(chatSendRefusal({ state: undefined })).toBeNull()
    expect(chatSendRefusal({})).toBeNull()
    expect(canSendFromChat({ state: 'done' })).toBe(true)
    expect(canSendFromChat({})).toBe(true)
  })

  it('refuses while the agent is working', () => {
    expect(chatSendRefusal({ state: 'working' })).toBe('working')
    expect(canSendFromChat({ state: 'working' })).toBe(false)
  })

  it('refuses while a TUI dialog is up: Enter would answer it', () => {
    // PermissionRequest / AskUserQuestion normalize to `waiting`, a permission Notification to
    // `blocked` — both are select dialogs where sendText's trailing Enter confirms the highlight.
    expect(chatSendRefusal({ state: 'waiting' })).toBe('dialog')
    expect(chatSendRefusal({ state: 'blocked' })).toBe('dialog')
  })

  it('refuses a hibernated node even though its state still reads done: a SHELL owns the pane', () => {
    expect(chatSendRefusal({ state: 'done', hibernated: true })).toBe('asleep')
    expect(canSendFromChat({ state: 'done', hibernated: true })).toBe(false)
    expect(chatSendRefusal({ hibernated: true })).toBe('asleep')
  })

  it('refuses a paused or dropped node for the same reason', () => {
    expect(chatSendRefusal({ state: 'done', paused: true })).toBe('paused')
    expect(chatSendRefusal({ state: 'done', dropped: true })).toBe('dropped')
  })

  it('a shell-owned pane outranks a stale live state', () => {
    expect(chatSendRefusal({ state: 'working', hibernated: true })).toBe('asleep')
  })
})

describe('chatComposerPlaceholder', () => {
  const base = { readonly: false, agentLabel: 'Grok', chip: '⌘M' }

  it('names the node agent in the sendable copy', () => {
    expect(chatComposerPlaceholder({ ...base, refusal: null })).toBe(
      'Message Grok…  (Enter to send, Shift+Enter for a new line)'
    )
    expect(chatComposerPlaceholder({ ...base, agentLabel: 'Claude Code', refusal: null })).toBe(
      'Message Claude Code…  (Enter to send, Shift+Enter for a new line)'
    )
  })

  it('names the agent while working', () => {
    expect(chatComposerPlaceholder({ ...base, refusal: 'working' })).toBe('Grok is working…')
  })

  it('points a dialog back at the terminal through the bound chord', () => {
    expect(chatComposerPlaceholder({ ...base, refusal: 'dialog' })).toBe(
      'Grok is waiting for an answer in the terminal — press ⌘M to answer there'
    )
  })

  it('never promises a chord that is unbound', () => {
    const text = chatComposerPlaceholder({ ...base, chip: '', refusal: 'dialog' })
    expect(text).toBe('Grok is waiting for an answer in the terminal — switch back to the terminal to answer')
    expect(text).not.toMatch(/press/)
  })

  it('tells an asleep, paused or dropped node how to come back, by the chip it shows', () => {
    expect(chatComposerPlaceholder({ ...base, refusal: 'asleep' })).toBe(
      'Grok is asleep to save memory — click SLEEPING in the node header to resume it'
    )
    expect(chatComposerPlaceholder({ ...base, refusal: 'paused' })).toBe(
      'Grok is paused — click PAUSED in the node header to resume it'
    )
    expect(chatComposerPlaceholder({ ...base, refusal: 'dropped' })).toBe(
      'Grok is no longer running in this terminal — click DROPPED in the node header to resume it'
    )
  })

  it('a write failure wins over every refusal', () => {
    expect(chatComposerPlaceholder({ ...base, readonly: true, refusal: 'dialog' })).toBe(
      "Can't write to this session"
    )
  })
})
