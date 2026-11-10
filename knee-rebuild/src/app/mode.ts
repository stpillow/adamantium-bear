import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import { engineMode, type EngineModeState } from '../rules/engineMode.ts'
import { keptRaw, parseKept, subscribeAccount } from './account.ts'

/*
 * The engine mode as the screens read it (M-U3, PROGRAM-QUESTIONS 223 to 225): decided by
 * src/rules/engineMode.ts from the account answer this context last kept and whether the phone
 * holds pre-accounts writes, never stored. The shell provides it beside the time zone; every
 * screen reads it with `useEngineMode()` and passes `mode` to its helpers. A sign-in or sign-out,
 * here or in another tab of this browser, applies on the next render; nothing stored changes.
 */

/** Outside the provider a screen fails safe: no engine. */
export const EngineModeContext = createContext<EngineModeState>({ mode: 'tester', reason: 'unconfirmed' })

export function useEngineMode(): EngineModeState {
  return useContext(EngineModeContext)
}

/** A change in this context (`subscribeAccount`) or in another tab of the same browser (`storage`). */
function subscribe(onChange: () => void): () => void {
  const stop = subscribeAccount(onChange)
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === 'knee-rebuild:account') onChange()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    stop()
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * The mode for the shell to provide. The snapshot is the stored string, which compares by value: a
 * freshly parsed object on every read would never settle.
 */
export function useEngineModeSource(preAccounts: boolean): EngineModeState {
  const raw = useSyncExternalStore(subscribe, () => keptRaw())
  return useMemo(() => engineMode(parseKept(raw), preAccounts), [raw, preAccounts])
}
