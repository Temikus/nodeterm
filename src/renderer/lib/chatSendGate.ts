import type { AgentState } from '@shared/agents/normalize'

/**
 * May the ⌘M chat composer type into the agent's pane right now?
 *
 * `pty.sendText` pastes the text and then presses Enter. That is a prompt only while the agent's
 * input box owns the pane. In `waiting` (Claude's PermissionRequest AND AskUserQuestion both
 * normalize to it, `shared/agents/normalize.ts`) and `blocked` (a permission Notification) the
 * pane holds a TUI select dialog the transcript view does not show — and Enter CONFIRMS the
 * highlighted option, which is "Yes" by default. A message typed into the chat would silently
 * grant a permission or pick an answer. Same trap CLAUDE.md documents for the in-place restart's
 * `/exit`, and the same refusal.
 *
 * `undefined` is ALLOWED: no hook knowledge (a custom agent, a session with no event yet in this
 * app run) is "unknown", not "unsafe", and refusing it would take the composer away from every
 * such node — the historical behavior is kept there. Only `done` is a positive "input box is up".
 */
export function canSendFromChat(state: AgentState | undefined): boolean {
  return state === undefined || state === 'done'
}

/**
 * The composer's placeholder — the one place the user learns WHY it is disabled. A dialog points
 * back at the terminal through the chord actually bound to the markdown/chat toggle (`chip`, from
 * `chipFor('node.toggleMarkdown')`); `''` = unbound, and then the text names the action instead
 * of promising a chord that never fires. A write failure (`readonly`) outranks every state: no
 * state change will make that session writable.
 */
export function chatComposerPlaceholder({
  readonly,
  state,
  chip
}: {
  readonly: boolean
  state: AgentState | undefined
  chip: string
}): string {
  if (readonly) return "Can't write to this session"
  if (state === 'working') return 'Claude is working…'
  if (!canSendFromChat(state)) {
    return chip
      ? `Claude is waiting for an answer in the terminal — press ${chip} to answer there`
      : 'Claude is waiting for an answer in the terminal — switch back to the terminal to answer'
  }
  return 'Message Claude…  (Enter to send)'
}
