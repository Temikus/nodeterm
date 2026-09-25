import { useEffect, useRef } from 'react'

/** The slice of an xterm `Terminal` this hook touches (its helper textarea holds DOM focus). */
export interface FocusableTerm {
  readonly textarea?: HTMLTextAreaElement
  blur(): void
  focus(): void
}

/**
 * Focus hand-off for a terminal node's ⌘M face (the output view AND the ChatPanel).
 *
 * Opening the view covers the xterm but used to leave it focused, so every keystroke kept flowing
 * into a pane the user could no longer see — into an agent's composer or a shell prompt. On entry
 * the terminal is blurred; on exit focus goes back ONLY if the terminal had it when the view
 * opened. Restoring unconditionally would pull focus out of whatever the user moved to meanwhile
 * (another node, a text field) the moment they toggle the view off from the menu.
 *
 * Entry state alone is not enough to restore: the view can stay open for minutes, and the user may
 * have moved on to a text field elsewhere (the view is toggled from the context menu or ⌘K, not
 * only by ⌘M over the node). So exit also asks where focus IS (`mayRestoreFocus`).
 *
 * `getTerm` is read at transition time, not captured: the node's xterm can be released, parked or
 * respawned while the view is open, and a stale instance must never be focused.
 */
export function useMdModeFocus(
  mdMode: boolean,
  getTerm: () => FocusableTerm | null | undefined,
  getRoot: () => Element | null | undefined
): void {
  const restoreRef = useRef(false)
  const prevRef = useRef(mdMode)
  const getTermRef = useRef(getTerm)
  getTermRef.current = getTerm
  const getRootRef = useRef(getRoot)
  getRootRef.current = getRoot

  useEffect(() => {
    if (prevRef.current === mdMode) return
    prevRef.current = mdMode
    const term = getTermRef.current()
    if (mdMode) {
      const ta = term?.textarea
      restoreRef.current = !!ta && document.activeElement === ta
      term?.blur()
    } else if (restoreRef.current) {
      restoreRef.current = false
      if (mayRestoreFocus(document.activeElement, getRootRef.current(), document.body)) term?.focus()
    }
  }, [mdMode])
}

/**
 * Whether exiting the ⌘M view may hand focus back to the xterm: only when focus is nowhere
 * (null / `<body>` — typically because the view's own ↻ button just unmounted with it) or still
 * inside this node. Focus anywhere else belongs to something the user chose meanwhile.
 */
export function mayRestoreFocus(
  active: Element | null,
  nodeRoot: Element | null | undefined,
  body: Element | null
): boolean {
  if (!active || active === body) return true
  return !!nodeRoot && nodeRoot.contains(active)
}

/**
 * The xterm focus call for every "take the keyboard" path in TerminalNode (hover dwell, click,
 * sidebar / notification jump, window-activation restore). While the ⌘M view covers the terminal
 * it must NOT focus: the overlay sits inside the node body, so a dwell over it — or a sidebar jump
 * to the node — used to route keystrokes into a pane nobody could see.
 */
export function focusXtermUnlessCovered(term: FocusableTerm | null | undefined, covered: boolean): void {
  if (!covered) term?.focus()
}

/**
 * Whether a file DROP or PASTE on the node body belongs to the terminal. The file handlers sit on
 * `.term-node__body`, which also hosts the ⌘M face — so while the view covers the xterm, a
 * screenshot pasted into the ChatPanel composer (or a file dropped on the output view) was caught
 * in the capture phase, written as a path into the hidden pane, and the xterm focused to match.
 * Covered, the handlers stand aside and the event behaves natively for whatever is under the
 * pointer / caret: a paste lands in the composer, a drop falls to the window-level guard.
 *
 * Keyed on the same cover flag as `focusXtermUnlessCovered`, not on the event target: the overlay
 * spans the whole body, so "covered" already answers "is this event aimed at the view", and one
 * flag cannot drift from the focus rule the way a second list of overlay selectors could.
 */
export function terminalOwnsFileInput(covered: boolean): boolean {
  return !covered
}
