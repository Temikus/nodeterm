import { TEXT_NOT_SUBMITTED } from '@shared/text-delivery'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { useAgentStatus } from '../state/agentStatus'
import { useSession } from '../session/session'
import type { ChatMessage } from '@shared/types'
import { chipFor } from '../lib/keybindingOverrides'
import { chatComposerPlaceholder, chatSendRefusal } from '../lib/chatSendGate'
import { chatAgentLabel, chatKeyAction, isNearBottom, shouldFollowOnLoad } from '../lib/chatPanel'
import { useSettings } from '../state/settings'
import { E_UNSUPPORTED } from '@shared/rpc'

// Memoized bubble: marked+DOMPurify re-ran for EVERY message on each ChatPanel render (each
// turn-finish reload, each keystroke re-render). Text is stable per message, so cache per text.
export const MarkdownText = memo(function MarkdownText({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return <div className="term-chat__text" dangerouslySetInnerHTML={{ __html: html }} />
})

interface ChatPanelProps {
  nodeId: string
  sessionId?: string
  cwd?: string
  /** Managed Claude account this node runs under; resolves the transcript in the right root. */
  accountId?: string
  /** Which agent's reader to use. REQUIRED, and not cosmetic: claude's resolver falls back to the
   *  newest transcript for the cwd, so a non-claude node that arrives unlabelled is answered with
   *  another session's conversation. It was optional until 2026-09-02, defaulting to claude -- and
   *  deleting the single `agentId={agentId}` at the one mount site left the typecheck and 3767
   *  tests green while restoring that leak in full. Required makes the compiler the proof: the
   *  wiring cannot be dropped silently, with no render test needed to notice. */
  agentId: string
  /**
   * Read a transcript with no live session behind it (issue #531: a CLOSED node's conversation,
   * opened from "Recently closed"). Hides the composer — `pty.sendText` would be aimed at a node
   * id that no longer exists — and names the bar for what it is. Absent = the ⌘M panel on a live
   * node, byte-identical to before.
   */
  readOnly?: boolean
  /** Bar caption. Defaults to the ⌘M panel's own 'Chat'. */
  title?: string
  /** Rendered at the right of the bar in place of the ⌘M exit hint. */
  hint?: string
}

/**
 * Why the transcript isn't on screen. Every one of these used to render as "No conversation
 * yet.": a rejected read (this surface has no transcript reader at all) left `messages` at its
 * initial `[]` because nothing caught the rejection, and a failed resolution was indistinguishable
 * from a session nobody has spoken to. They need different words — and two of them are retryable.
 */
type LoadState = 'loading' | 'ok' | 'missing' | 'unsupported' | 'error'

const isUnsupported = (e: unknown): boolean =>
  !!e && typeof e === 'object' && (e as { code?: string }).code === E_UNSUPPORTED

/** One line each, in the user's terms: what is on screen and whether waiting will fix it.
 *  `missing` names the two causes that actually produce it — a transcript Claude has cleaned up
 *  (30 days by default), and a remote session whose host hasn't been reached yet — because the
 *  second one heals by itself the moment the session speaks, and the first one never will. */
const EMPTY_TEXT: Record<LoadState, { title: string; detail?: string }> = {
  loading: { title: 'Loading conversation…' },
  ok: { title: 'No conversation yet.' },
  missing: {
    title: 'No transcript found for this session.',
    detail: "It may have been cleaned up, or the agent's host isn't reachable yet."
  },
  unsupported: {
    title: "Transcripts can't be read on this surface.",
    detail: 'Open this session on the desktop app to read its conversation.'
  },
  error: { title: "Couldn't read the transcript." }
}

/**
 * Chat view for a chat-capable agent node (Cmd+M). Renders the session transcript as
 * markdown bubbles with collapsible tool calls, and sends new prompts into the running tmux
 * session via pty.sendText. Phase 1 reloads the transcript whenever a turn finishes
 * (working -> idle); live streaming is a later phase. Replaces the markdown-of-output overlay.
 */
export function ChatPanel({
  nodeId,
  sessionId,
  cwd,
  accountId,
  agentId,
  readOnly,
  title,
  hint
}: ChatPanelProps) {
  // This node's core api (stable for the session — the chat transcript and the tmux session
  // both live on the core this panel's project belongs to).
  const { api } = useSession()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [input, setInput] = useState('')
  const [readonly, setReadonly] = useState(false)
  const state = useAgentStatus((s) => s.byId[nodeId]?.state)
  // The shell-owned-pane flags, each as its own primitive selector (an object selector would
  // re-render on every hook event for every node). See lib/chatSendGate.ts for why they gate.
  const hibernated = useAgentStatus((s) => s.byId[nodeId]?.hibernated)
  const paused = useAgentStatus((s) => s.byId[nodeId]?.paused)
  const dropped = useAgentStatus((s) => s.byId[nodeId]?.dropped)
  const sessionEnded = useAgentStatus((s) => s.byId[nodeId]?.sessionEnded)
  const customAgents = useSettings((s) => s.settings.customAgents)
  const msgsRef = useRef<HTMLDivElement>(null)
  const prevState = useRef(state)
  // Request token: only the NEWEST readTranscript may land. An older read resolving late (the
  // sessionId changed underneath it, or a ↻ raced the turn-finish reload) would otherwise paint
  // another session's thread over the current one. Bumped on unmount too, so a read that resolves
  // after the panel closed is dropped rather than applied to a dead component.
  const reqRef = useRef(0)
  // Scroll-follow inputs, captured BEFORE a load changes the content: was the user following the
  // bottom (updated on every scroll), and did they just send (they expect to see it land).
  const nearBottomRef = useRef(true)
  const justSentRef = useRef(false)

  const load = useCallback(() => {
    const token = ++reqRef.current
    setLoadState((s) => (s === 'ok' ? s : 'loading')) // a reload never blanks a rendered thread
    // `nodeId` is what lets an SSH-project node resolve on its host; the rejection branch is what
    // keeps a surface that cannot read transcripts (Server Edition, relay tab) from silently
    // presenting itself as an empty conversation.
    void api.chat.readTranscript(sessionId, cwd, accountId, nodeId, agentId).then(
      (res) => {
        if (token !== reqRef.current) return
        setMessages(res.messages)
        setLoadState(res.found ? 'ok' : 'missing')
      },
      (e: unknown) => {
        if (token !== reqRef.current) return
        setLoadState(isUnsupported(e) ? 'unsupported' : 'error')
      }
    )
  }, [api, sessionId, cwd, accountId, nodeId, agentId])

  // Initial load.
  useEffect(() => {
    load()
  }, [load])

  // Invalidate any in-flight read when the panel goes away.
  useEffect(
    () => () => {
      reqRef.current++
    },
    []
  )

  // Reload when a turn completes (working -> not working). Sessions whose hooks never report
  // `working` never take this path — the bar's ↻ is their reload.
  useEffect(() => {
    if (prevState.current === 'working' && state !== 'working') load()
    prevState.current = state
  }, [state, load])

  // Follow the newest message only when the user was already at the bottom or just sent; a user
  // scrolled up reading an earlier answer keeps their place. Layout effect: the jump lands before
  // paint, so a followed thread never flashes one frame short.
  useLayoutEffect(() => {
    const el = msgsRef.current
    if (!el) return
    if (shouldFollowOnLoad({ wasNearBottom: nearBottomRef.current, justSent: justSentRef.current })) {
      el.scrollTop = el.scrollHeight
      nearBottomRef.current = true
    }
    justSentRef.current = false
  }, [messages])

  const onScroll = () => {
    const el = msgsRef.current
    if (el) nearBottomRef.current = isNearBottom(el)
  }

  // Not just `working`: a TUI dialog (`waiting`/`blocked`) would be ANSWERED by sendText's Enter,
  // and a pane whose CLI is gone (hibernated/paused/dropped/exited) is a SHELL that would execute it.
  const refusal = chatSendRefusal(agentId, { state, hibernated, paused, dropped, sessionEnded })
  const agentLabel = chatAgentLabel(agentId, customAgents)

  const send = useCallback(async () => {
    const text = input.trim()
    // Read the store at SEND time, not the render-time values: a PermissionRequest (or an Eco
    // hibernation) that landed between the last render and this keypress must still block.
    if (!text || chatSendRefusal(agentId, useAgentStatus.getState().byId[nodeId] ?? {}) !== null) return
    const ok = await api.pty.sendText(nodeId, text)
    if (ok === 'pasted-not-submitted') {
      window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { kind: 'error', message: TEXT_NOT_SUBMITTED } }))
      setInput('')
      return
    }
    if (!ok) {
      setReadonly(true)
      return
    }
    // Optimistic: show the prompt immediately; the next load() reconciles from the transcript.
    justSentRef.current = true
    setMessages((m) => [...m, { role: 'user', parts: [{ kind: 'text', text }] }])
    setInput('')
  }, [api, input, nodeId, agentId])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter falls through to the textarea's own newline; an IME commit is not a send.
    const action = chatKeyAction({
      key: e.key,
      shiftKey: e.shiftKey,
      isComposing: e.nativeEvent.isComposing || e.keyCode === 229
    })
    if (action !== 'send') return
    e.preventDefault()
    void send()
  }

  // Whatever the markdown/chat toggle is bound to; '' when unbound, in which case the bar names
  // the action instead of promising a chord that never fires.
  const mdChip = chipFor('node.toggleMarkdown')

  return (
    <div className="term-chat nodrag nowheel">
      <div className="term-chat__bar">
        <span>{title ?? 'Chat'}</span>
        <span className="term-chat__bar-end">
          <button
            className="term-chat__refresh"
            onClick={load}
            title="Reload conversation"
            aria-label="Reload conversation"
          >
            ↻
          </button>
          <span className="term-chat__hint">{hint ?? (mdChip ? `${mdChip} to exit` : 'Exit')}</span>
        </span>
      </div>
      <div className="term-chat__msgs" ref={msgsRef} onScroll={onScroll}>
        {messages.length === 0 && loadState !== 'loading' && (
          <div className="term-chat__empty">
            <div>{EMPTY_TEXT[loadState].title}</div>
            {EMPTY_TEXT[loadState].detail && (
              <div className="term-chat__empty-detail">{EMPTY_TEXT[loadState].detail}</div>
            )}
            {loadState !== 'unsupported' && loadState !== 'ok' && (
              <button className="term-chat__retry" onClick={load}>
                Retry
              </button>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`term-chat__msg term-chat__msg--${m.role}`}>
            {m.parts.map((p, j) =>
              p.kind === 'text' ? (
                <MarkdownText key={j} text={p.text} />
              ) : p.kind === 'thinking' ? (
                // Reasoning, not the answer: collapsed by default so it cannot be mistaken for it.
                <details key={j} className="term-chat__thinking">
                  <summary>Thinking</summary>
                  <MarkdownText text={p.text} />
                </details>
              ) : (
                <details key={j} className="term-chat__tool">
                  <summary>
                    <span className="term-chat__tool-name">{p.name}</span>
                    {p.arg && <span className="term-chat__tool-arg">{p.arg}</span>}
                  </summary>
                  {p.result && <pre className="term-chat__tool-result">{p.result}</pre>}
                </details>
              )
            )}
          </div>
        ))}
      </div>
      {!readOnly && (
      <div className="term-chat__compose">
        <textarea
          className="term-chat__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={chatComposerPlaceholder({ readonly, refusal, agentLabel, chip: mdChip })}
          disabled={readonly || refusal !== null}
          rows={2}
        />
      </div>
      )}
    </div>
  )
}
