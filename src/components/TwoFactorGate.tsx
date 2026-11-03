import React, { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { normalizeCode, verifiedTotpFactors, verifySignInCode } from '@/lib/mfa'

/**
 * The second step of sign-in. A user with two-factor sign-in on whose session
 * is still password-only sees this instead of the app, on every page, until
 * they enter a code or sign out. It cannot be dismissed: the backend refuses
 * that session anyway, so the page behind it would only show errors.
 */
const TwoFactorGate: React.FC = () => {
  const { user, session, assurance, signOut } = useAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const open = Boolean(user && session && !assurance.satisfied)
  const factor = verifiedTotpFactors(session?.user)[0]

  useEffect(() => {
    if (!open) {
      setCode('')
      setError(null)
    }
  }, [open])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!session || !factor) return
    setBusy(true)
    setError(null)
    try {
      await verifySignInCode(session, factor.id, code)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The code could not be checked. Try again.')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-sm" data-testid="two-factor-gate">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-green-600" aria-hidden="true" />
            Enter your sign-in code
          </AlertDialogTitle>
          <AlertDialogDescription>
            Two-factor sign-in is on for {user?.email ?? 'this account'}. Open your authenticator app and
            enter the 6-digit code for DataAfrik.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {factor ? (
          <form className="space-y-3" onSubmit={submit}>
            <div className="space-y-1">
              <Label htmlFor="two-factor-code">Code</Label>
              <Input
                id="two-factor-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={9}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(normalizeCode(e.target.value).slice(0, 6))}
                aria-invalid={error ? 'true' : 'false'}
                aria-describedby={error ? 'two-factor-error' : undefined}
              />
            </div>
            {error && (
              <p id="two-factor-error" role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => signOut()} disabled={busy}>
                Sign out
              </Button>
              <Button type="submit" disabled={busy || code.length !== 6} className="bg-green-600 hover:bg-green-700">
                {busy ? 'Checking…' : 'Verify'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              This account needs a second sign-in step this app cannot offer for it. Sign out and sign in again.
            </p>
            <Button type="button" variant="outline" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default TwoFactorGate
