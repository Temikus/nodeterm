import type { AgentState } from '@shared/agents/normalize'

/** The slice of a node's agent status the composer gate reads (`AgentNodeStatus` fits it). */
export interface ChatGateStatus {
  state?: AgentState
  hibernated?: boolean
  paused?: boolean
  dropped?: boolean
}

/** Why the composer refuses to send; `null` = it may send. */
export type ChatSendRefusal = 'working' | 'dialog' | 'asleep' | 'paused' | 'dropped' | null

/**
 * May the ⌘M chat composer type into the agent's pane right now — and if not, why?
 *
 * `pty.sendText` pastes the text and then presses Enter. That is a prompt only while the agent's
 * input box owns the pane. Two ways it does not:
 *
 * - **A TUI dialog** (`waiting`/`blocked`). Claude's PermissionRequest AND AskUserQuestion both
 *   normalize to `waiting` (`shared/agents/normalize.ts`), a permission Notification to `blocked`.
 *   The pane then holds a select dialog the transcript view does not show, and Enter CONFIRMS the
 *   highlighted option — "Yes" by default. A chat message would silently grant a permission or
 *   pick an answer. Same trap CLAUDE.md documents for the in-place restart's `/exit`.
 * - **A SHELL** (hibernated / paused / dropped). Eco's hibernation exits the CLI and leaves the
 *   node's `state` at `done`, so the state alone reads "sendable" — but the pane now belongs to
 *   the login shell, and the message would be EXECUTED as a shell command. Pause and an
 *   unaccounted CLI exit (DROPPED) leave the pane in the same shell. These flags therefore rank
 *   ABOVE the state: a stale live state cannot vouch for a CLI that is known to be gone.
 *
 * No hook knowledge (`state` undefined, no flags — a custom agent, a session with no event yet in
 * this app run) is ALLOWED: unknown is not unsafe, and refusing it would take the composer away
 * from every such node. Only `done` is a positive "input box is up".
 */
export function chatSendRefusal(s: ChatGateStatus): ChatSendRefusal {
  if (s.dropped) return 'dropped'
  if (s.paused) return 'paused'
  if (s.hibernated) return 'asleep'
  if (s.state === 'working') return 'working'
  if (s.state === 'waiting' || s.state === 'blocked') return 'dialog'
  return null
}

export function canSendFromChat(s: ChatGateStatus): boolean {
  return chatSendRefusal(s) === null
}

/**
 * The composer's placeholder — the one place the user learns WHY it is disabled, naming the
 * node's own agent (the panel serves grok and base-claude custom agents too, not only Claude).
 *
 * A dialog points back at the terminal through the chord actually bound to the markdown/chat
 * toggle (`chip`, from `chipFor('node.toggleMarkdown')`); `''` = unbound, and then the text names
 * the action instead of promising a chord that never fires. A shell-owned pane names the header
 * chip that resumes it — the same SLEEPING / PAUSED / DROPPED chip whose click runs the wake,
 * visible above this panel. A write failure (`readonly`) outranks everything: no state change will
 * make that session writable.
 */
export function chatComposerPlaceholder({
  readonly,
  refusal,
  agentLabel,
  chip
}: {
  readonly: boolean
  refusal: ChatSendRefusal
  agentLabel: string
  chip: string
}): string {
  if (readonly) return "Can't write to this session"
  switch (refusal) {
    case 'working':
      return `${agentLabel} is working…`
    case 'dialog':
      return chip
        ? `${agentLabel} is waiting for an answer in the terminal — press ${chip} to answer there`
        : `${agentLabel} is waiting for an answer in the terminal — switch back to the terminal to answer`
    case 'asleep':
      return `${agentLabel} is asleep to save memory — click SLEEPING in the node header to resume it`
    case 'paused':
      return `${agentLabel} is paused — click PAUSED in the node header to resume it`
    case 'dropped':
      return `${agentLabel} is no longer running in this terminal — click DROPPED in the node header to resume it`
    case null:
      return `Message ${agentLabel}…  (Enter to send, Shift+Enter for a new line)`
  }
}
