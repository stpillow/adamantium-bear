import { useEffect, useId, useState } from 'react'
import { accountStatus, redeemCode, signOut, type AccountState } from '../../app/account.ts'
import { Button } from '../../components/Button.tsx'
import { Note, Section } from '../../components/FormParts.tsx'
import { SIGNED_OUT_LEAD, SIGNED_OUT_NOTE, SIGN_OUT_NOTE, accountView, codeProblem, redeemWords, signOutWords } from '../Account.helpers.ts'

/**
 * Settings, Account (M-U2; PROGRAM-QUESTIONS 220): an invite code typed here signs this phone's app
 * in. Hidden on a deployment without accounts. The code is the one free-text field outside notes: a
 * one-time entry, not logging. What shows is accountView's call; the role decides nothing here.
 */
export function AccountSection() {
  const id = useId()
  const [state, setState] = useState<AccountState | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void accountStatus().then((s) => {
      if (live) setState(s)
    })
    return () => {
      live = false
    }
  }, [])

  if (state === null) return null
  const view = accountView(state)
  if (view.kind === 'hidden') return null

  const redeem = async () => {
    const shape = codeProblem(code)
    setSaid(null)
    setProblem(shape)
    if (shape) return
    setBusy(true)
    try {
      const result = await redeemCode(code)
      if (result.ok) {
        setState({ answer: result.answer, from: 'server', online: true })
        setCode('')
      } else {
        setProblem(redeemWords(result))
      }
    } finally {
      setBusy(false)
    }
  }
  const leave = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const result = await signOut()
      if (result.ok) {
        setState({ answer: { configured: true, signedIn: false }, from: 'server', online: true })
        setSaid(signOutWords(result))
      } else {
        setProblem(signOutWords(result))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section label="Account" saved={false} problem={problem}>
      {said ? <p className="text-body text-on-dark">{said}</p> : null}
      {view.kind === 'note' ? <p className="text-body text-on-dark-dim">{view.line}</p> : null}
      {view.kind === 'signed-in' ? (
        <>
          <p className="text-body text-on-dark wrap-anywhere">{view.line}</p>
          <Note>{view.note}</Note>
          <Button wide disabled={busy || !view.canSignOut} onClick={() => void leave()}>
            {busy ? 'Signing out…' : 'Sign out'}
          </Button>
          <Note>{SIGN_OUT_NOTE}</Note>
        </>
      ) : null}
      {view.kind === 'signed-out' ? (
        <>
          <label htmlFor={id} className="text-body text-on-dark-dim">
            {SIGNED_OUT_LEAD}
          </label>
          <input
            id={id}
            type="text"
            aria-label="Invite code"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={32}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            value={code}
            disabled={busy || !view.canRedeem}
            onChange={(e) => setCode(e.target.value)}
            className="tap w-full rounded-sm bg-ink px-3 text-body uppercase text-on-dark disabled:opacity-50"
          />
          <Button wide variant="primary" disabled={busy || !view.canRedeem} onClick={() => void redeem()}>
            {busy ? 'Redeeming…' : 'Redeem'}
          </Button>
          {view.note ? <Note>{view.note}</Note> : null}
          <Note>{SIGNED_OUT_NOTE}</Note>
        </>
      ) : null}
    </Section>
  )
}
