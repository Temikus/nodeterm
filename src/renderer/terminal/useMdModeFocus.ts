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
 * `getTerm` is read at transition time, not captured: the node's xterm can be released, parked or
 * respawned while the view is open, and a stale instance must never be focused.
 */
export function useMdModeFocus(mdMode: boolean, getTerm: () => FocusableTerm | null | undefined): void {
  const restoreRef = useRef(false)
  const prevRef = useRef(mdMode)
  const getTermRef = useRef(getTerm)
  getTermRef.current = getTerm

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
      term?.focus()
    }
  }, [mdMode])
}
