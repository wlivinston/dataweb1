import { describe, expect, it } from 'vitest'
import { estimateFederalTax, incomeTaxCents, scheduleTaxCents, taxTableRow, type TaxInput, type W2 } from '../tax/federalEstimate'
import { FEDERAL_YEARS } from '../tax/federalTables'

// Every expected figure below is worked by hand from the IRS tables in
// federalTables.ts (sources listed there), shown in the comment above it.
// None was read off the code.

const w2 = (wages: number, withheld: number, extra: Partial<W2> = {}): W2 => ({
  owner: 'taxpayer',
  wages,
  federalWithheld: withheld,
  socialSecurityWages: wages,
  socialSecurityWithheld: Math.round(wages * 6.2) / 100,
  medicareWages: wages,
  medicareWithheld: Math.round(wages * 1.45) / 100,
  ...extra,
})

const input = (over: Partial<TaxInput>): TaxInput => ({
  year: 2025,
  filingStatus: 'single',
  taxpayer: { age65OrOlder: false, blind: false },
  qualifyingChildren: 0,
  otherDependents: 0,
  canBeClaimedAsDependent: false,
  w2s: [],
  ...over,
})

const ok = (result: ReturnType<typeof estimateFederalTax>) => {
  if (!result.ok) throw new Error(result.refusal)
  return result
}
const line = (result: ReturnType<typeof ok>, label: string) => result.lines.find(l => l.label === label)?.amount

describe('the IRS Tax Table (taxable income under $100,000)', () => {
  it('rows are $5/$10/$25 wide at the bottom, $25 to $3,000, then $50', () => {
    expect(taxTableRow(0)).toEqual({ from: 0, to: 5 })
    expect(taxTableRow(12)).toEqual({ from: 5, to: 15 })
    expect(taxTableRow(30)).toEqual({ from: 25, to: 50 })
    expect(taxTableRow(2_999)).toEqual({ from: 2_975, to: 3_000 })
    expect(taxTableRow(3_000)).toEqual({ from: 3_000, to: 3_050 })
    expect(taxTableRow(44_274)).toEqual({ from: 44_250, to: 44_300 })
  })

  // 2025 single, $50,000-$50,050: midpoint 50,025.
  //   1,192.50 + 12% x 36,550 (4,386.00) + 22% x 1,550 (341.00) = 5,919.50 -> 5,920
  // (published 2025 Tax Table cell: $5,920 - half a dollar rounds up)
  it('taxes the row midpoint and rounds half a dollar up', () => {
    const single2025 = FEDERAL_YEARS[2025].brackets.single
    expect(incomeTaxCents(5_000_000, single2025).taxCents).toBe(592_000)
    expect(incomeTaxCents(5_004_999, single2025).taxCents).toBe(592_000)
  })

  // At $100,000 the rate schedule applies to the exact income:
  //   2025 single: 1,192.50 + 4,386.00 + 22% x 51,525 (11,335.50) = 16,914.00
  it('switches to the rate schedule at $100,000', () => {
    const single2025 = FEDERAL_YEARS[2025].brackets.single
    expect(incomeTaxCents(10_000_000, single2025).taxCents).toBe(1_691_400)
    expect(scheduleTaxCents(10_000_000, single2025)).toBe(1_691_400)
  })
})

describe('estimates, worked by hand', () => {
  // A. 2025 single, one W-2: wages 60,000, withheld 6,000.
  //   taxable 60,000 - 15,750 = 44,250; row 44,250-44,300, midpoint 44,275
  //   tax 1,192.50 + 12% x 32,350 (3,882.00) = 5,074.50 -> 5,075
  //   refund 6,000 - 5,075 = 925
  it('A. single, one job', () => {
    const r = ok(estimateFederalTax(input({ w2s: [w2(60_000, 6_000)] })))
    expect(line(r, 'Taxable income')).toBe(44_250)
    expect(line(r, 'Income tax')).toBe(5_075)
    expect(r.totalTax).toBe(5_075)
    expect(r.refundOrOwed).toBe(925)
    expect(r.notes).toEqual([])
  })

  // B. 2025 married filing jointly, two children, wages 70,000 + 30,000,
  //    withheld 4,000 + 1,500.
  //   taxable 100,000 - 31,500 = 68,500; midpoint 68,525
  //   tax 2,385 + 12% x 44,675 (5,361.00) = 7,746
  //   child tax credit 2 x 2,200 = 4,400 (below the $400,000 phase-out; under the tax)
  //   total tax 7,746 - 4,400 = 3,346; refund 5,500 - 3,346 = 2,154
  it('B. joint, two children', () => {
    const r = ok(estimateFederalTax(input({
      filingStatus: 'married_joint',
      spouse: { age65OrOlder: false, blind: false },
      qualifyingChildren: 2,
      w2s: [w2(70_000, 4_000), w2(30_000, 1_500, { owner: 'spouse' })],
    })))
    expect(line(r, 'Taxable income')).toBe(68_500)
    expect(line(r, 'Income tax')).toBe(7_746)
    expect(line(r, 'Child tax credit / credit for other dependents')).toBe(4_400)
    expect(line(r, 'Additional child tax credit (refundable)')).toBeUndefined()
    expect(r.totalTax).toBe(3_346)
    expect(r.refundOrOwed).toBe(2_154)
  })

  // C. 2026 head of household, one child, wages 20,000, withheld 300.
  //   taxable 20,000 - 24,150 < 0 -> 0; tax 0; no credit can be used against tax
  //   refundable: min(unused 2,200, 1,700 per child, 15% x (20,000 - 2,500) = 2,625) = 1,700
  //   refund 300 + 1,700 = 2,000
  it('C. head of household, low income: the refundable credit', () => {
    const r = ok(estimateFederalTax(input({
      year: 2026, filingStatus: 'head_of_household', qualifyingChildren: 1, w2s: [w2(20_000, 300)],
    })))
    expect(line(r, 'Income tax')).toBe(0)
    expect(line(r, 'Child tax credit / credit for other dependents')).toBe(0)
    expect(line(r, 'Additional child tax credit (refundable)')).toBe(1_700)
    expect(r.refundOrOwed).toBe(2_000)
    expect(r.notes.some(n => n.includes('earned income credit'))).toBe(true)
  })

  // D. 2026 single, two employers: wages 150,000 (withheld 30,000) + 100,000 (20,000).
  //   taxable 250,000 - 16,100 = 233,900 (rate schedule)
  //   1,240 + 12% x 38,000 (4,560) + 22% x 55,300 (12,166) + 24% x 96,075 (23,058)
  //     + 32% x 32,125 (10,280) = 51,304
  //   Additional Medicare: 0.9% x (250,000 - 200,000) = 450; none withheld
  //     (each employer stayed under $200,000, so withheld exactly 1.45%)
  //   total tax 51,754
  //   Social Security: 9,300 + 6,200 = 15,500 withheld; maximum 6.2% x 184,500 = 11,439
  //     -> excess 4,061
  //   payments 50,000 + 4,061 = 54,061; refund 2,307
  it('D. two employers, high income: Additional Medicare and excess Social Security', () => {
    const r = ok(estimateFederalTax(input({
      year: 2026, w2s: [w2(150_000, 30_000, { employer: 'A' }), w2(100_000, 20_000, { employer: 'B' })],
    })))
    expect(line(r, 'Income tax')).toBe(51_304)
    expect(line(r, 'Additional Medicare Tax')).toBe(450)
    expect(line(r, 'Additional Medicare Tax withheld')).toBeUndefined()
    expect(line(r, 'Excess Social Security tax withheld')).toBe(4_061)
    expect(r.totalTax).toBe(51_754)
    expect(r.totalPayments).toBe(54_061)
    expect(r.refundOrOwed).toBe(2_307)
  })

  // E. 2025 single, age 65, wages 90,000, withheld 9,000.
  //   standard deduction 15,750 + 2,000 (unmarried, 65+) = 17,750
  //   senior deduction 6,000 - 6% x (90,000 - 75,000) = 6,000 - 900 = 5,100
  //   taxable 90,000 - 17,750 - 5,100 = 67,150; midpoint 67,175
  //   tax 1,192.50 + 4,386.00 + 22% x 18,700 (4,114.00) = 9,692.50 -> 9,693
  //   owed 9,693 - 9,000 = 693
  it('E. age 65: the extra standard deduction and the senior deduction', () => {
    const r = ok(estimateFederalTax(input({ taxpayer: { age65OrOlder: true, blind: false }, w2s: [w2(90_000, 9_000)] })))
    expect(line(r, 'Standard deduction')).toBe(17_750)
    expect(line(r, 'Senior deduction (age 65+)')).toBe(5_100)
    expect(line(r, 'Income tax')).toBe(9_693)
    expect(r.refundOrOwed).toBe(-693)
    expect(r.lines.at(-1)!.label).toBe('Estimated amount you owe')
  })

  // F. Child tax credit phase-out: $50 per $1,000 OR FRACTION over the threshold.
  //   2025 single, one child, wages 200,500: 500 over -> one step -> 2,200 - 50 = 2,150
  it('F. the child tax credit phases out per $1,000 or fraction', () => {
    const r = ok(estimateFederalTax(input({ qualifyingChildren: 1, w2s: [w2(200_500, 40_000)] })))
    expect(line(r, 'Child tax credit / credit for other dependents')).toBe(2_150)
    // 0.9% x 500 = 4.50
    expect(line(r, 'Additional Medicare Tax')).toBe(4.5)
  })

  // G. 2025 head of household, two children, wages 10,000, nothing withheld.
  //   taxable 0, tax 0; unused credit 4,400; cap 2 x 1,700 = 3,400
  //   15% x (10,000 - 2,500) = 1,125 -> refundable credit 1,125 (the earnings limit binds)
  it('G. the refundable credit is limited to 15% of wages above $2,500', () => {
    const r = ok(estimateFederalTax(input({ filingStatus: 'head_of_household', qualifyingChildren: 2, w2s: [w2(10_000, 0)] })))
    expect(line(r, 'Additional child tax credit (refundable)')).toBe(1_125)
    expect(r.refundOrOwed).toBe(1_125)
  })

  it('one employer over-withholding Social Security is not a credit, and is flagged', () => {
    const r = ok(estimateFederalTax(input({ year: 2026, w2s: [w2(100_000, 15_000, { employer: 'Acme', socialSecurityWithheld: 12_000 })] })))
    expect(line(r, 'Excess Social Security tax withheld')).toBeUndefined()
    expect(r.notes.some(n => n.includes('Acme') && n.includes('employer should refund'))).toBe(true)
  })

  it('checks each W-2 for copying mistakes', () => {
    const r = ok(estimateFederalTax(input({ w2s: [w2(60_000, 6_000, { employer: 'Acme', socialSecurityWithheld: 3_270 })] })))
    expect(r.notes.some(n => n.includes('Acme: box 4'))).toBe(true)
  })

  it('the senior deduction needs a joint return when married', () => {
    const r = ok(estimateFederalTax(input({ filingStatus: 'married_separate', taxpayer: { age65OrOlder: true, blind: false }, w2s: [w2(50_000, 5_000)] })))
    expect(line(r, 'Senior deduction (age 65+)')).toBeUndefined()
    // married amount for the 65+ addition: 15,750 + 1,600
    expect(line(r, 'Standard deduction')).toBe(17_350)
  })
})

describe('what it refuses rather than estimates', () => {
  it.each([
    ['an unsupported year', input({ year: 2024, w2s: [w2(1, 0)] }), 'not supported'],
    ['a taxpayer someone else can claim', input({ canBeClaimedAsDependent: true, w2s: [w2(1, 0)] }), 'dependent'],
    ['no W-2', input({}), 'at least one W-2'],
    ['a spouse W-2 on a single return', input({ w2s: [w2(1, 0, { owner: 'spouse' })] }), 'joint return'],
    ['a negative box', input({ w2s: [w2(-5, 0)] }), 'zero or more'],
  ])('%s', (_, given, message) => {
    const r = estimateFederalTax(given)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.refusal).toContain(message)
  })
})
