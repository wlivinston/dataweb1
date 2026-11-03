import React, { useMemo, useState } from 'react'
import { AlertTriangle, ListChecks } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { AccountCategory, LinePlacement, PlacementBasis } from '@/lib/financeTypes'

export const CATEGORY_LABELS: Record<string, string> = {
  revenue: 'Revenue',
  cost_of_goods_sold: 'Cost of goods sold',
  operating_expense: 'Operating expense',
  other_income: 'Other income',
  other_expense: 'Other expense',
  tax: 'Income tax',
  current_asset: 'Current asset',
  non_current_asset: 'Non-current asset',
  contra_asset: 'Contra asset (e.g. accumulated depreciation)',
  current_liability: 'Current liability',
  non_current_liability: 'Non-current liability',
  equity: 'Equity',
}

const MOVABLE: AccountCategory[] = [
  'revenue', 'cost_of_goods_sold', 'operating_expense', 'other_income', 'other_expense', 'tax',
  'current_asset', 'non_current_asset', 'contra_asset', 'current_liability', 'non_current_liability', 'equity',
]

const BASIS: Record<PlacementBasis, { label: string; className: string; explain: string }> = {
  file: { label: 'Your file', className: 'bg-green-100 text-green-800', explain: 'Your file names this line\'s statement.' },
  name: { label: 'Account name', className: 'bg-blue-100 text-blue-800', explain: 'The account name says what kind of account it is.' },
  section: { label: 'Section heading', className: 'bg-sky-100 text-sky-800', explain: 'A heading in your file contains a statement word.' },
  'name-ambiguous': { label: 'Please confirm', className: 'bg-amber-100 text-amber-900', explain: 'This name reads two ways (e.g. fees charged or fees paid).' },
  guess: { label: 'Guessed', className: 'bg-red-100 text-red-800', explain: 'Nothing in the file said; placed by the amount\'s sign or as an expense by default.' },
}

const needsLook = (basis: PlacementBasis) => basis === 'guess' || basis === 'name-ambiguous'

interface Props {
  placement: LinePlacement[]
  overrides: Record<string, AccountCategory>
  formatCurrency: (amount: number) => string
  onMove: (account: string, category: AccountCategory) => void
  busy?: boolean
}

/**
 * Where every line of the file went, and on what basis. Lines placed by
 * guesswork or by a two-way name are listed first and can be moved; the
 * report is then run again with the user's choice.
 */
const LinePlacementPanel: React.FC<Props> = ({ placement, overrides, formatCurrency, onMove, busy }) => {
  const flagged = useMemo(
    () => placement.filter(line => needsLook(line.basis) && !overrides[line.account]),
    [placement, overrides]
  )
  const [showAll, setShowAll] = useState(false)
  const counts = useMemo(() => {
    const out: Record<PlacementBasis, number> = { file: 0, name: 0, section: 0, 'name-ambiguous': 0, guess: 0 }
    for (const line of placement) out[line.basis] += 1
    return out
  }, [placement])
  const moved = Object.keys(overrides).length
  const rows = showAll ? placement : flagged
  if (placement.length === 0) return null

  return (
    <Card className={flagged.length > 0 ? 'border-amber-300' : ''} data-testid="line-placement">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {flagged.length > 0 ? (
            <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
          ) : (
            <ListChecks className="h-4 w-4 text-green-600" aria-hidden="true" />
          )}
          Where each line went
        </CardTitle>
        <p className="text-sm text-gray-600">
          {placement.length} accounts: {counts.file} placed by your file&apos;s own labels, {counts.name + counts.section} by
          account names or headings
          {counts['name-ambiguous'] + counts.guess > 0 && (
            <>, <strong>{counts['name-ambiguous'] + counts.guess} by guesswork or a name that reads two ways</strong></>
          )}
          .{moved > 0 && ` You moved ${moved}.`}
          {flagged.length > 0 && ' Check the lines below: a line on the wrong statement changes every total.'}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="py-1 pr-3 font-medium">Account</th>
                  <th className="py-1 pr-3 font-medium text-right">Net (debit +)</th>
                  <th className="py-1 pr-3 font-medium">Placed by</th>
                  <th className="py-1 font-medium">Statement</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(line => {
                  const basis = overrides[line.account] ? null : BASIS[line.basis]
                  return (
                    <tr key={`${line.account}|${line.category}`} className="border-t">
                      <td className="py-1.5 pr-3 break-words">{line.account}</td>
                      <td className="py-1.5 pr-3 text-right font-mono whitespace-nowrap">{formatCurrency(line.net)}</td>
                      <td className="py-1.5 pr-3">
                        {basis ? (
                          <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${basis.className}`} title={basis.explain}>
                            {basis.label}
                          </span>
                        ) : (
                          <Badge variant="outline" className="text-xs">You moved it</Badge>
                        )}
                      </td>
                      <td className="py-1.5">
                        <select
                          aria-label={`Statement for ${line.account}`}
                          className="w-full min-w-[11rem] rounded border border-gray-300 bg-white px-2 py-1 text-sm"
                          value={overrides[line.account] ?? line.category}
                          disabled={busy}
                          onChange={e => onMove(line.account, e.target.value as AccountCategory)}
                        >
                          {MOVABLE.map(category => (
                            <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length === 0 && !showAll && (
          <p className="text-sm text-green-700">Every line was placed by your file&apos;s labels or a clear account name.</p>
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => setShowAll(value => !value)}>
          {showAll ? 'Show only lines to check' : `Show all ${placement.length} accounts`}
        </Button>
      </CardContent>
    </Card>
  )
}

export default LinePlacementPanel
