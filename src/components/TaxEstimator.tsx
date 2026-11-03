import React, { useMemo, useRef, useState } from 'react'
import { AlertTriangle, FileUp, Info, Lock, Plus, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { estimateFederalTax, type TaxInput, type W2 } from '@/lib/tax/federalEstimate'
import { FEDERAL_YEARS, type FilingStatus } from '@/lib/tax/federalTables'
import { parseMoney } from '@/lib/money'
import type { W2Read } from '@/lib/tax/w2Parse'

/** What was read from a PDF into one W-2 card, until the user confirms it. */
interface PdfFill {
  file: string
  /** Boxes filled from the PDF that the user has not edited since. */
  fromPdf: BoxKey[]
  conflicts: BoxKey[]
  notes: string[]
  confirmed: boolean
}

const formatBox = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const STATUSES: Array<{ value: FilingStatus; label: string }> = [
  { value: 'single', label: 'Single' },
  { value: 'married_joint', label: 'Married filing jointly' },
  { value: 'married_separate', label: 'Married filing separately' },
  { value: 'head_of_household', label: 'Head of household' },
  { value: 'surviving_spouse', label: 'Qualifying surviving spouse' },
]

const BOXES: Array<{ key: BoxKey; box: string; label: string }> = [
  { key: 'wages', box: '1', label: 'Wages, tips, other compensation' },
  { key: 'federalWithheld', box: '2', label: 'Federal income tax withheld' },
  { key: 'socialSecurityWages', box: '3', label: 'Social Security wages' },
  { key: 'socialSecurityWithheld', box: '4', label: 'Social Security tax withheld' },
  { key: 'medicareWages', box: '5', label: 'Medicare wages and tips' },
  { key: 'medicareWithheld', box: '6', label: 'Medicare tax withheld' },
]

type BoxKey = 'wages' | 'federalWithheld' | 'socialSecurityWages' | 'socialSecurityWithheld' | 'medicareWages' | 'medicareWithheld'
type W2Draft = { id: number; owner: 'taxpayer' | 'spouse'; employer: string } & Record<BoxKey, string>

const emptyW2 = (id: number, owner: 'taxpayer' | 'spouse' = 'taxpayer'): W2Draft =>
  ({ id, owner, employer: '', wages: '', federalWithheld: '', socialSecurityWages: '', socialSecurityWithheld: '', medicareWages: '', medicareWithheld: '' })

const money = (amount: number) =>
  `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const years = Object.keys(FEDERAL_YEARS).map(Number).sort((a, b) => b - a)

/**
 * A federal income tax estimate from W-2s. Everything is worked out in the
 * browser; nothing typed here is sent anywhere.
 */
const TaxEstimator: React.FC = () => {
  // The latest supported year: the one people are planning for.
  const [year, setYear] = useState(years[0])
  const [status, setStatus] = useState<FilingStatus>('single')
  const [you, setYou] = useState({ age65OrOlder: false, blind: false })
  const [spouse, setSpouse] = useState({ age65OrOlder: false, blind: false })
  const [children, setChildren] = useState('0')
  const [others, setOthers] = useState('0')
  const [dependent, setDependent] = useState(false)
  const [drafts, setDrafts] = useState<W2Draft[]>([emptyW2(1)])
  const [nextId, setNextId] = useState(2)
  const [pdfFills, setPdfFills] = useState<Record<number, PdfFill>>({})
  const [uploadMessage, setUploadMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)
  const [reading, setReading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const joint = status === 'married_joint'

  const unreadable = useMemo(() => {
    const bad: string[] = []
    drafts.forEach((draft, index) => {
      for (const { key, box } of BOXES) {
        const raw = draft[key]
        if (raw.trim() !== '' && parseMoney(raw) === null) bad.push(`W-2 #${index + 1} box ${box}`)
      }
    })
    return bad
  }, [drafts])

  const estimate = useMemo(() => {
    const w2s: W2[] = drafts
      .filter(draft => joint || draft.owner === 'taxpayer')
      .map(draft => {
        const read = (key: BoxKey) => parseMoney(draft[key]) ?? 0
        return {
          owner: draft.owner,
          employer: draft.employer.trim() || undefined,
          wages: read('wages'),
          federalWithheld: read('federalWithheld'),
          socialSecurityWages: read('socialSecurityWages'),
          socialSecurityWithheld: read('socialSecurityWithheld'),
          medicareWages: read('medicareWages'),
          medicareWithheld: read('medicareWithheld'),
        }
      })
      .filter(w => w.wages > 0 || w.federalWithheld > 0)
    const input: TaxInput = {
      year,
      filingStatus: status,
      taxpayer: you,
      spouse: joint ? spouse : undefined,
      qualifyingChildren: Number.parseInt(children, 10) || 0,
      otherDependents: Number.parseInt(others, 10) || 0,
      canBeClaimedAsDependent: dependent,
      w2s,
    }
    return estimateFederalTax(input)
  }, [drafts, joint, year, status, you, spouse, children, others, dependent])

  const update = (id: number, key: BoxKey | 'employer' | 'owner', value: string) => {
    setDrafts(list => list.map(draft => (draft.id === id ? { ...draft, [key]: value } : draft)))
    // A box the user typed over is theirs, not the PDF's.
    setPdfFills(fills => {
      const fill = fills[id]
      if (!fill || !fill.fromPdf.includes(key as BoxKey)) return fills
      return { ...fills, [id]: { ...fill, fromPdf: fill.fromPdf.filter(k => k !== key), conflicts: fill.conflicts.filter(k => k !== key) } }
    })
  }

  const unconfirmed = drafts.some(draft => pdfFills[draft.id] && !pdfFills[draft.id].confirmed)

  const onPdf = async (file: File) => {
    setReading(true)
    setUploadMessage(null)
    try {
      // Loaded only when a W-2 is uploaded; runs in this browser.
      const { readW2File } = await import('@/lib/tax/w2Pdf')
      const result: W2Read = await readW2File(file)
      if (!result.ok) {
        setUploadMessage({ tone: 'error', text: `${file.name}: ${result.reason}` })
        return
      }
      const filled = (Object.keys(result.boxes) as BoxKey[])
      if (filled.length === 0) {
        setUploadMessage({ tone: 'error', text: `${file.name}: no W-2 boxes could be read. Type them in by hand.` })
        return
      }
      const blank = drafts.find(d => !d.employer && BOXES.every(({ key }) => d[key].trim() === '') && !pdfFills[d.id])
      const id = blank ? blank.id : nextId
      const draft: W2Draft = { ...(blank ?? emptyW2(id)), employer: result.employer ?? (blank?.employer || '') }
      for (const key of filled) draft[key] = formatBox(result.boxes[key]!.value)
      setDrafts(list => (blank ? list.map(d => (d.id === id ? draft : d)) : [...list, draft]))
      if (!blank) setNextId(n => n + 1)
      const notes = [...result.notes]
      if (result.year !== null) {
        if (years.includes(result.year)) {
          if (result.year !== year) {
            setYear(result.year)
            notes.unshift(`Tax year set to ${result.year}, as printed on this W-2.`)
          }
        } else {
          notes.unshift(`This W-2 is for ${result.year}, which this estimate does not support yet.`)
        }
      }
      setPdfFills(fills => ({
        ...fills,
        [id]: {
          file: file.name,
          fromPdf: filled,
          conflicts: filled.filter(key => result.boxes[key]!.confidence === 'conflict'),
          notes,
          confirmed: false,
        },
      }))
      setUploadMessage({ tone: 'info', text: `Read ${filled.length} of 6 boxes from ${file.name}. Check each one against your W-2 below.` })
    } finally {
      setReading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Federal tax estimate</h1>
        <p className="mt-1 text-gray-600">
          Enter the numbers from your W-2s to estimate your federal income tax refund or balance due.
        </p>
        <p className="mt-2 flex items-center gap-2 text-sm text-gray-500">
          <Lock className="h-4 w-4" aria-hidden="true" />
          Worked out in your browser. Nothing you type here is sent or saved.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-lg">About you</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="tax-year">Tax year</Label>
                  <select id="tax-year" className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" value={year} onChange={e => setYear(Number(e.target.value))}>
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tax-status">Filing status</Label>
                  <select id="tax-status" className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" value={status} onChange={e => setStatus(e.target.value as FilingStatus)}>
                    {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">You</legend>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={you.age65OrOlder} onChange={e => setYou({ ...you, age65OrOlder: e.target.checked })} /> 65 or older by the end of the year</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={you.blind} onChange={e => setYou({ ...you, blind: e.target.checked })} /> Blind</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dependent} onChange={e => setDependent(e.target.checked)} /> Someone else can claim me as a dependent</label>
              </fieldset>
              {joint && (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Your spouse</legend>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={spouse.age65OrOlder} onChange={e => setSpouse({ ...spouse, age65OrOlder: e.target.checked })} /> 65 or older by the end of the year</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={spouse.blind} onChange={e => setSpouse({ ...spouse, blind: e.target.checked })} /> Blind</label>
                </fieldset>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="tax-children">Children under 17</Label>
                  <Input id="tax-children" inputMode="numeric" value={children} onChange={e => setChildren(e.target.value.replace(/\D/g, ''))} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tax-others">Other dependents</Label>
                  <Input id="tax-others" inputMode="numeric" value={others} onChange={e => setOthers(e.target.value.replace(/\D/g, ''))} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-dashed">
            <CardContent className="pt-5 space-y-2">
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                id="w2-pdf-upload"
                onChange={e => { const file = e.target.files?.[0]; if (file) void onPdf(file) }}
              />
              <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} disabled={reading}>
                <FileUp className="h-4 w-4 mr-2" /> {reading ? 'Reading…' : 'Upload a W-2 PDF'}
              </Button>
              <p className="text-xs text-gray-500">
                The PDF from your employer or payroll provider. It is read here in your browser and not uploaded anywhere. Your Social Security number is not read.
              </p>
              {uploadMessage && (
                <p role={uploadMessage.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${uploadMessage.tone === 'error' ? 'text-red-700' : 'text-green-800'}`}>
                  {uploadMessage.text}
                </p>
              )}
            </CardContent>
          </Card>

          {drafts.map((draft, index) => (
            <Card key={draft.id} data-testid="w2-card">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">W-2 #{index + 1}</CardTitle>
                  {drafts.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setDrafts(list => list.filter(d => d.id !== draft.id)); setPdfFills(fills => { const next = { ...fills }; delete next[draft.id]; return next }) }} aria-label={`Remove W-2 #${index + 1}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {pdfFills[draft.id] && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-2" data-testid="w2-pdf-fill">
                    <p>Read from <strong>{pdfFills[draft.id].file}</strong>. Boxes marked &quot;from PDF&quot; must be checked against your W-2.</p>
                    {pdfFills[draft.id].notes.length > 0 && (
                      <ul className="list-disc pl-5 space-y-0.5">{pdfFills[draft.id].notes.map(n => <li key={n}>{n}</li>)}</ul>
                    )}
                    <label className="flex items-center gap-2 font-medium">
                      <input
                        type="checkbox"
                        checked={pdfFills[draft.id].confirmed}
                        onChange={e => setPdfFills(fills => ({ ...fills, [draft.id]: { ...fills[draft.id], confirmed: e.target.checked } }))}
                      />
                      I have checked these boxes against my W-2
                    </label>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`w2-${draft.id}-employer`}>Employer (optional)</Label>
                    <Input id={`w2-${draft.id}-employer`} value={draft.employer} onChange={e => update(draft.id, 'employer', e.target.value)} />
                  </div>
                  {joint && (
                    <div className="space-y-1">
                      <Label htmlFor={`w2-${draft.id}-owner`}>Whose W-2</Label>
                      <select id={`w2-${draft.id}-owner`} className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" value={draft.owner} onChange={e => update(draft.id, 'owner', e.target.value)}>
                        <option value="taxpayer">Mine</option>
                        <option value="spouse">My spouse&apos;s</option>
                      </select>
                    </div>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {BOXES.map(({ key, box, label }) => (
                    <div key={key} className="space-y-1">
                      <Label htmlFor={`w2-${draft.id}-${key}`} className="text-xs">
                        Box {box}: {label}
                        {pdfFills[draft.id]?.fromPdf.includes(key) && (
                          <span className={`ml-1 rounded px-1 ${pdfFills[draft.id].conflicts.includes(key) ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'}`}>
                            {pdfFills[draft.id].conflicts.includes(key) ? 'copies disagree' : 'from PDF'}
                          </span>
                        )}
                      </Label>
                      <Input
                        id={`w2-${draft.id}-${key}`}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={draft[key]}
                        onChange={e => update(draft.id, key, e.target.value)}
                        className={pdfFills[draft.id]?.fromPdf.includes(key) ? (pdfFills[draft.id].conflicts.includes(key) ? 'border-red-400' : 'border-amber-400') : undefined}
                      />
                    </div>
                  ))}
                </div>
                {!joint && draft.owner === 'spouse' && (
                  <p className="text-xs text-amber-700">This is marked as your spouse&apos;s W-2; it is only used on a joint return.</p>
                )}
              </CardContent>
            </Card>
          ))}
          <Button type="button" variant="outline" onClick={() => { setDrafts(list => [...list, emptyW2(nextId)]); setNextId(id => id + 1) }}>
            <Plus className="h-4 w-4 mr-2" /> Add another W-2
          </Button>
        </div>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {unreadable.length > 0 && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-4 text-sm text-red-800">
                These boxes could not be read as amounts and are counted as zero: {unreadable.join(', ')}.
              </CardContent>
            </Card>
          )}
          {unconfirmed ? (
            <Card className="border-amber-200 bg-amber-50" data-testid="tax-unconfirmed">
              <CardContent className="pt-4 flex gap-2 text-sm text-amber-900">
                <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                Check the boxes read from your W-2 PDF and tick &quot;I have checked these boxes against my W-2&quot; to see the estimate.
              </CardContent>
            </Card>
          ) : !estimate.ok ? (
            <Card className="border-amber-200 bg-amber-50" data-testid="tax-refusal">
              <CardContent className="pt-4 flex gap-2 text-sm text-amber-900">
                <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" /> {estimate.refusal}
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className={estimate.refundOrOwed >= 0 ? 'border-green-300' : 'border-red-300'} data-testid="tax-result">
                <CardContent className="pt-5">
                  <p className="text-sm text-gray-600">{estimate.refundOrOwed >= 0 ? 'Estimated refund' : 'Estimated amount you owe'} ({estimate.year})</p>
                  <p className={`text-3xl font-bold ${estimate.refundOrOwed >= 0 ? 'text-green-700' : 'text-red-700'}`}>{money(Math.abs(estimate.refundOrOwed))}</p>
                  <p className="mt-1 text-xs text-gray-500">An estimate, not a tax return. See what is not included below.</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">How it was worked out</CardTitle></CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <tbody>
                      {estimate.lines.map(l => (
                        <tr key={l.form + l.label} className={`border-t align-top ${l.kind === 'subtotal' || l.kind === 'result' ? 'font-semibold' : ''}`}>
                          <td className="py-1.5 pr-2">
                            {l.label}
                            <span className="block text-xs font-normal text-gray-500">{l.form}{l.how ? ` - ${l.how}` : ''}</span>
                          </td>
                          <td className="py-1.5 text-right font-mono whitespace-nowrap">{money(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
              {estimate.notes.length > 0 && (
                <Card className="border-amber-200">
                  <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" /> Worth a look</CardTitle></CardHeader>
                  <CardContent><ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">{estimate.notes.map(n => <li key={n}>{n}</li>)}</ul></CardContent>
                </Card>
              )}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Not included in this estimate</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">{estimate.notIncluded.map(n => <li key={n}>{n}</li>)}</ul>
                  <p className="text-xs text-gray-500">If any of these apply to you, your actual tax will differ. Figures from: {estimate.sources.join('; ')}.</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default TaxEstimator
