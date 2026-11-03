import React, { useCallback, useEffect, useState } from 'react'
import type { Factor } from '@supabase/supabase-js'
import { ShieldCheck, ShieldOff } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  finishEnrollment,
  listAuthenticators,
  normalizeCode,
  removeAuthenticator,
  startEnrollment,
  type PendingEnrollment,
} from '@/lib/mfa'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Step = 'loading' | 'off' | 'enrolling' | 'on' | 'unavailable'

/** Turn two-factor sign-in on (scan a QR code, confirm one code) or off. */
const TwoFactorSettings: React.FC<Props> = ({ open, onOpenChange }) => {
  const [step, setStep] = useState<Step>('loading')
  const [factors, setFactors] = useState<Factor[]>([])
  const [pending, setPending] = useState<PendingEnrollment | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setStep('loading')
    setError(null)
    try {
      const verified = await listAuthenticators()
      setFactors(verified)
      setStep(verified.length > 0 ? 'on' : 'off')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your sign-in settings.')
      setStep('unavailable')
    }
  }, [])

  useEffect(() => {
    if (open) {
      setPending(null)
      setCode('')
      void refresh()
    }
  }, [open, refresh])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const begin = () =>
    run(async () => {
      setPending(await startEnrollment())
      setCode('')
      setStep('enrolling')
    })

  const confirm = (event: React.FormEvent) => {
    event.preventDefault()
    if (!pending) return
    void run(async () => {
      try {
        await finishEnrollment(pending.factorId, code)
      } catch (caught) {
        setCode('')
        throw caught
      }
      setPending(null)
      await refresh()
    })
  }

  const turnOff = (factorId: string) =>
    run(async () => {
      await removeAuthenticator(factorId)
      await refresh()
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="two-factor-settings">
        <DialogHeader>
          <DialogTitle>Two-factor sign-in</DialogTitle>
          <DialogDescription>
            After your password, also ask for a 6-digit code from an authenticator app (Google
            Authenticator, Microsoft Authenticator, 1Password, Authy…). Someone who learns your
            password still cannot sign in or reach your data.
          </DialogDescription>
        </DialogHeader>

        {step === 'loading' && <p className="text-sm text-gray-600">Loading…</p>}

        {step === 'unavailable' && (
          <Button type="button" variant="outline" onClick={() => void refresh()}>
            Try again
          </Button>
        )}

        {step === 'off' && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-gray-700">
              <ShieldOff className="h-4 w-4 text-amber-600" aria-hidden="true" />
              Off. Your password alone signs you in.
            </p>
            <Button type="button" onClick={begin} disabled={busy} className="bg-green-600 hover:bg-green-700">
              {busy ? 'Starting…' : 'Turn on'}
            </Button>
          </div>
        )}

        {step === 'enrolling' && pending && (
          <form className="space-y-3" onSubmit={confirm}>
            <p className="text-sm text-gray-700">1. Scan this with your authenticator app.</p>
            <img
              src={pending.qrCode}
              alt="QR code to add DataAfrik to your authenticator app"
              className="mx-auto h-44 w-44 rounded border bg-white p-2"
            />
            <p className="text-xs text-gray-600">
              Can't scan? Enter this key in the app instead:{' '}
              <code className="break-all rounded bg-gray-100 px-1 py-0.5 text-gray-900" data-testid="two-factor-secret">
                {pending.secret}
              </code>
            </p>
            <div className="space-y-1">
              <Label htmlFor="two-factor-enroll-code">2. Enter the 6-digit code it shows</Label>
              <Input
                id="two-factor-enroll-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={9}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(normalizeCode(e.target.value).slice(0, 6))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => void refresh()} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || code.length !== 6} className="bg-green-600 hover:bg-green-700">
                {busy ? 'Checking…' : 'Confirm and turn on'}
              </Button>
            </div>
          </form>
        )}

        {step === 'on' && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-gray-700">
              <ShieldCheck className="h-4 w-4 text-green-600" aria-hidden="true" />
              On. Signing in asks for a code from your authenticator app.
            </p>
            <ul className="space-y-2">
              {factors.map((factor) => (
                <li key={factor.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                  <span>
                    {factor.friendly_name || 'Authenticator app'}
                    <span className="block text-xs text-gray-500">
                      Added {new Date(factor.created_at).toLocaleDateString()}
                    </span>
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={() => turnOff(factor.id)} disabled={busy}>
                    Turn off
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default TwoFactorSettings
