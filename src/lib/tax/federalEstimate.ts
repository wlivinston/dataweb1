// A federal income tax estimate from W-2s, laid out the way Form 1040 does it.
//
// Scope, deliberately narrow: wages from W-2s, the standard deduction (with
// the 65+/blind additions and the 2025-2028 senior deduction), the ordinary
// brackets, the child tax credit and credit for other dependents (Schedule
// 8812), Additional Medicare Tax (Form 8959) and excess Social Security
// withholding. Everything else is listed as not included, and a situation the
// rules here would get wrong is refused rather than estimated.
//
// Two IRS details that change the answer by dollars, both applied:
//  - Below $100,000 of taxable income Form 1040 requires the Tax Table, whose
//    rows are $50 wide (narrower below $3,000) and whose tax is the schedule
//    tax at the row's MIDPOINT, rounded half up to whole dollars. The exact
//    schedule would differ from the 1040 by up to ~$6.
//  - The child tax credit phases out by $50 per $1,000 of income over the
//    threshold, or any fraction of $1,000.
//
// Money is integer cents throughout.

import {
  ACTC_EARNED_INCOME_FLOOR, ACTC_RATE, ADDITIONAL_MEDICARE_RATE, ADDITIONAL_MEDICARE_THRESHOLD, FEDERAL_YEARS,
  MEDICARE_RATE, RATES, SOCIAL_SECURITY_RATE, TAX_TABLE_LIMIT,
  type Brackets, type FederalYear, type FilingStatus,
} from './federalTables';

export interface W2 {
  /** Whose W-2: only joint returns have a spouse's. */
  owner: 'taxpayer' | 'spouse';
  employer?: string;
  /** Box 1 */ wages: number;
  /** Box 2 */ federalWithheld: number;
  /** Box 3 */ socialSecurityWages: number;
  /** Box 4 */ socialSecurityWithheld: number;
  /** Box 5 */ medicareWages: number;
  /** Box 6 */ medicareWithheld: number;
}

export interface Person {
  age65OrOlder: boolean;
  blind: boolean;
}

export interface TaxInput {
  year: number;
  filingStatus: FilingStatus;
  taxpayer: Person;
  /** Joint returns only. */
  spouse?: Person;
  /** Qualifying children under 17 at the end of the year. */
  qualifyingChildren: number;
  /** Other dependents (credit for other dependents). */
  otherDependents: number;
  /** Someone else can claim the taxpayer (or spouse) as a dependent. */
  canBeClaimedAsDependent: boolean;
  w2s: W2[];
}

export interface EstimateLine {
  /** The Form 1040 (or schedule) line this corresponds to. */
  form: string;
  label: string;
  /** Dollars, to the cent. */
  amount: number;
  /** How it was worked out, in words. */
  how?: string;
  kind?: 'income' | 'deduction' | 'subtotal' | 'tax' | 'credit' | 'payment' | 'result';
}

export type Estimate =
  | {
      ok: true;
      year: number;
      lines: EstimateLine[];
      /** Positive: refund. Negative: amount owed. */
      refundOrOwed: number;
      totalTax: number;
      totalPayments: number;
      /** Checks on the W-2s and situations worth a second look. */
      notes: string[];
      notIncluded: string[];
      sources: string[];
    }
  | { ok: false; refusal: string };

const cents = (dollars: number): number => Math.round(dollars * 100);
const dollars = (c: number): number => c / 100;
/** Round cents to whole dollars, half up (the Tax Table's rounding). */
const roundToDollarCents = (c: number): number => Math.floor((c + 50) / 100) * 100;

const bracketsFor = (table: FederalYear, status: FilingStatus): Brackets =>
  table.brackets[status === 'surviving_spouse' ? 'married_joint' : status];

const standardFor = (table: FederalYear, status: FilingStatus): number =>
  table.standardDeduction[status === 'surviving_spouse' ? 'married_joint' : status];

const isMarriedForAdditional = (status: FilingStatus) =>
  status === 'married_joint' || status === 'married_separate' || status === 'surviving_spouse';

/** Tax from the rate schedule, in cents, on a taxable income in cents. */
export function scheduleTaxCents(taxableCents: number, brackets: Brackets): number {
  let tax = 0;
  let lower = 0;
  for (let i = 0; i < RATES.length; i++) {
    const upper = brackets[i] === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : cents(brackets[i]);
    if (taxableCents <= lower) break;
    const inBand = Math.min(taxableCents, upper) - lower;
    tax += inBand * RATES[i];
    lower = upper;
  }
  return Math.round(tax);
}

/** The Tax Table row (in dollars) that a taxable income falls in. */
export function taxTableRow(taxable: number): { from: number; to: number } {
  if (taxable < 5) return { from: 0, to: 5 };
  if (taxable < 15) return { from: 5, to: 15 };
  if (taxable < 25) return { from: 15, to: 25 };
  if (taxable < 50) return { from: 25, to: 50 };
  if (taxable < 3_000) {
    const from = 50 + Math.floor((taxable - 50) / 25) * 25;
    return { from, to: from + 25 };
  }
  const from = Math.floor(taxable / 50) * 50;
  return { from, to: from + 50 };
}

/** Income tax as Form 1040 line 16 computes it for ordinary income. */
export function incomeTaxCents(taxableCents: number, brackets: Brackets): { taxCents: number; how: string } {
  if (taxableCents <= 0) return { taxCents: 0, how: 'No taxable income.' };
  const taxable = dollars(taxableCents);
  if (taxable < TAX_TABLE_LIMIT) {
    const row = taxTableRow(taxable);
    const midpointCents = cents((row.from + row.to) / 2);
    return {
      taxCents: roundToDollarCents(scheduleTaxCents(midpointCents, brackets)),
      how: `Tax Table row $${row.from.toLocaleString()}-$${row.to.toLocaleString()} (tax on the row's midpoint, rounded to whole dollars, as the IRS table does).`,
    };
  }
  return { taxCents: scheduleTaxCents(taxableCents, brackets), how: 'Tax Computation Worksheet (rate schedule), for taxable income of $100,000 or more.' };
}

const NOT_INCLUDED = [
  'Income other than W-2 wages: interest, dividends, capital gains, self-employment or 1099 income, unemployment, retirement distributions, Social Security benefits',
  'Adjustments and itemized deductions: IRA, HSA, student loan interest; mortgage interest, state and local taxes, charity',
  'The 2025-2028 deductions for tips, overtime and car loan interest',
  'Earned income credit, education credits, child and dependent care credit, saver\'s credit',
  'The additional child tax credit method for three or more children (it can only raise the refund)',
  'State and local income tax',
];

/** A federal estimate from W-2s, or the reason it cannot be made. */
export function estimateFederalTax(input: TaxInput): Estimate {
  const table = FEDERAL_YEARS[input.year];
  if (!table) {
    return { ok: false, refusal: `Tax year ${input.year} is not supported. Supported years: ${Object.keys(FEDERAL_YEARS).join(', ')}.` };
  }
  if (input.canBeClaimedAsDependent) {
    return { ok: false, refusal: 'Someone else can claim you as a dependent. Your standard deduction is then limited by a different rule this estimate does not apply.' };
  }
  if (input.w2s.length === 0) return { ok: false, refusal: 'Enter at least one W-2.' };
  const joint = input.filingStatus === 'married_joint';
  if (!joint && input.w2s.some(w => w.owner === 'spouse')) {
    return { ok: false, refusal: 'A spouse\'s W-2 belongs on a joint return. Choose "Married filing jointly", or leave the spouse\'s W-2 out.' };
  }
  const numbers = input.w2s.flatMap(w => [w.wages, w.federalWithheld, w.socialSecurityWages, w.socialSecurityWithheld, w.medicareWages, w.medicareWithheld]);
  if (numbers.some(n => !Number.isFinite(n) || n < 0)) {
    return { ok: false, refusal: 'Every W-2 box must be a number of zero or more.' };
  }
  if (![input.qualifyingChildren, input.otherDependents].every(n => Number.isInteger(n) && n >= 0)) {
    return { ok: false, refusal: 'The numbers of children and other dependents must be whole numbers.' };
  }

  const notes: string[] = [];
  const lines: EstimateLine[] = [];
  const sum = (pick: (w: W2) => number) => input.w2s.reduce((total, w) => total + cents(pick(w)), 0);

  // --- Income -------------------------------------------------------------
  const wagesCents = sum(w => w.wages);
  lines.push({ form: '1040 line 1a', label: 'Wages (W-2 box 1)', amount: dollars(wagesCents), kind: 'income', how: `${input.w2s.length} W-2${input.w2s.length > 1 ? 's' : ''}.` });
  const agiCents = wagesCents;
  lines.push({ form: '1040 line 11', label: 'Adjusted gross income', amount: dollars(agiCents), kind: 'subtotal', how: 'Wages only; no other income or adjustments are included.' });

  // --- Deductions ---------------------------------------------------------
  const people: Person[] = [input.taxpayer, ...(joint && input.spouse ? [input.spouse] : [])];
  const conditions = people.reduce((n, p) => n + (p.age65OrOlder ? 1 : 0) + (p.blind ? 1 : 0), 0);
  const perCondition = isMarriedForAdditional(input.filingStatus)
    ? table.additionalStandardDeduction.married
    : table.additionalStandardDeduction.unmarried;
  const standardCents = cents(standardFor(table, input.filingStatus) + conditions * perCondition);
  lines.push({
    form: '1040 line 12',
    label: 'Standard deduction',
    amount: dollars(standardCents),
    kind: 'deduction',
    how: conditions > 0
      ? `$${standardFor(table, input.filingStatus).toLocaleString()} plus $${perCondition.toLocaleString()} for each of ${conditions} (age 65+ or blind).`
      : undefined,
  });
  if (input.filingStatus === 'married_separate' && input.spouse && (input.spouse.age65OrOlder || input.spouse.blind)) {
    notes.push('On a separate return your spouse\'s age or blindness counts only in narrow cases; it is not included here.');
  }

  let seniorCents = 0;
  const seniors = people.filter(p => p.age65OrOlder).length;
  if (table.seniorDeduction && seniors > 0) {
    if (input.filingStatus === 'married_separate') {
      notes.push('The senior deduction needs a joint return when married; it is not available on a separate return.');
    } else {
      const start = cents(joint ? table.seniorDeduction.phaseOutStart.joint : table.seniorDeduction.phaseOutStart.other);
      const reduction = Math.round(Math.max(0, agiCents - start) * table.seniorDeduction.phaseOutRate);
      const each = Math.max(0, cents(table.seniorDeduction.perPerson) - reduction);
      seniorCents = each * seniors;
      lines.push({
        form: 'Schedule 1-A',
        label: 'Senior deduction (age 65+)',
        amount: dollars(seniorCents),
        kind: 'deduction',
        how: reduction > 0
          ? `$6,000 each for ${seniors}, reduced by 6% of income above $${dollars(start).toLocaleString()}.`
          : `$6,000 each for ${seniors}.`,
      });
    }
  }

  const taxableCents = Math.max(0, agiCents - standardCents - seniorCents);
  lines.push({ form: '1040 line 15', label: 'Taxable income', amount: dollars(taxableCents), kind: 'subtotal' });

  // --- Tax ----------------------------------------------------------------
  const { taxCents, how: taxHow } = incomeTaxCents(taxableCents, bracketsFor(table, input.filingStatus));
  lines.push({ form: '1040 line 16', label: 'Income tax', amount: dollars(taxCents), kind: 'tax', how: taxHow });

  // --- Child tax credit and credit for other dependents (Schedule 8812) ----
  const ctc = table.childTaxCredit;
  const tentativeCents = cents(input.qualifyingChildren * ctc.perChild + input.otherDependents * ctc.otherDependent);
  let nonrefundableCents = 0;
  let refundableCents = 0;
  if (tentativeCents > 0) {
    const threshold = cents(joint ? ctc.phaseOutStart.joint : ctc.phaseOutStart.other);
    const excess = Math.max(0, agiCents - threshold);
    const reductionCents = excess > 0 ? Math.ceil(excess / cents(1000)) * cents(50) : 0;
    const creditCents = Math.max(0, tentativeCents - reductionCents);
    nonrefundableCents = Math.min(creditCents, taxCents);
    lines.push({
      form: '1040 line 19',
      label: 'Child tax credit / credit for other dependents',
      amount: dollars(nonrefundableCents),
      kind: 'credit',
      how: `$${ctc.perChild.toLocaleString()} x ${input.qualifyingChildren} children + $${ctc.otherDependent} x ${input.otherDependents} other dependents` +
        (reductionCents > 0 ? `, less $${dollars(reductionCents).toLocaleString()} phase-out` : '') +
        (nonrefundableCents < creditCents ? `; limited to your tax of $${dollars(taxCents).toLocaleString()}` : '') + '.',
    });
    if (input.qualifyingChildren > 0) {
      const unused = creditCents - nonrefundableCents;
      const cap = cents(input.qualifyingChildren * ctc.refundablePerChild);
      const earnedPart = Math.round(Math.max(0, wagesCents - cents(ACTC_EARNED_INCOME_FLOOR)) * ACTC_RATE);
      refundableCents = Math.min(unused, cap, earnedPart);
      if (refundableCents > 0) {
        lines.push({
          form: '1040 line 28',
          label: 'Additional child tax credit (refundable)',
          amount: dollars(refundableCents),
          kind: 'payment',
          how: `The unused credit, up to $${ctc.refundablePerChild.toLocaleString()} per child and 15% of wages above $2,500.`,
        });
      }
      if (input.qualifyingChildren >= 3 && earnedPart < Math.min(unused, cap)) {
        notes.push('With three or more children, Schedule 8812 has a second method that can give a larger refundable credit. It is not applied here, so the refund may be higher.');
      }
    }
  }

  // --- Additional Medicare Tax (Form 8959) --------------------------------
  const medicareWagesCents = sum(w => w.medicareWages);
  const additionalMedicareCents = Math.round(
    Math.max(0, medicareWagesCents - cents(ADDITIONAL_MEDICARE_THRESHOLD[input.filingStatus])) * ADDITIONAL_MEDICARE_RATE
  );
  if (additionalMedicareCents > 0) {
    lines.push({
      form: 'Schedule 2 line 11',
      label: 'Additional Medicare Tax',
      amount: dollars(additionalMedicareCents),
      kind: 'tax',
      how: `0.9% of Medicare wages above $${ADDITIONAL_MEDICARE_THRESHOLD[input.filingStatus].toLocaleString()}.`,
    });
  }
  const additionalMedicareWithheldCents = Math.max(0, sum(w => w.medicareWithheld) - Math.round(medicareWagesCents * MEDICARE_RATE));

  const totalTaxCents = taxCents - nonrefundableCents + additionalMedicareCents;
  lines.push({ form: '1040 line 24', label: 'Total tax', amount: dollars(totalTaxCents), kind: 'subtotal' });

  // --- Payments -----------------------------------------------------------
  const withheldCents = sum(w => w.federalWithheld);
  lines.push({ form: '1040 line 25a', label: 'Federal income tax withheld (W-2 box 2)', amount: dollars(withheldCents), kind: 'payment' });
  if (additionalMedicareWithheldCents > 0) {
    lines.push({ form: '1040 line 25c', label: 'Additional Medicare Tax withheld', amount: dollars(additionalMedicareWithheldCents), kind: 'payment', how: 'Medicare tax withheld above 1.45% of Medicare wages (Form 8959).' });
  }

  // Excess Social Security: only across two or more employers, per person.
  const ssMaxCents = Math.round(cents(table.socialSecurityWageBase) * SOCIAL_SECURITY_RATE);
  let excessSsCents = 0;
  for (const owner of ['taxpayer', 'spouse'] as const) {
    const theirs = input.w2s.filter(w => w.owner === owner);
    for (const w of theirs) {
      if (cents(w.socialSecurityWithheld) > ssMaxCents) {
        notes.push(`${w.employer || 'One employer'} withheld more Social Security tax than the yearly maximum ($${dollars(ssMaxCents).toLocaleString()}). That excess is not a credit on your return; the employer should refund it.`);
      }
    }
    if (theirs.length >= 2) {
      const creditable = theirs.reduce((total, w) => total + Math.min(cents(w.socialSecurityWithheld), ssMaxCents), 0);
      excessSsCents += Math.max(0, creditable - ssMaxCents);
    }
  }
  if (excessSsCents > 0) {
    lines.push({ form: 'Schedule 3 line 11', label: 'Excess Social Security tax withheld', amount: dollars(excessSsCents), kind: 'payment', how: `More than one employer withheld; the yearly maximum is $${dollars(ssMaxCents).toLocaleString()} per person.` });
  }

  const totalPaymentsCents = withheldCents + additionalMedicareWithheldCents + excessSsCents + refundableCents;
  lines.push({ form: '1040 line 33', label: 'Total payments', amount: dollars(totalPaymentsCents), kind: 'subtotal' });
  const resultCents = totalPaymentsCents - totalTaxCents;
  lines.push({
    form: resultCents >= 0 ? '1040 line 34' : '1040 line 37',
    label: resultCents >= 0 ? 'Estimated refund' : 'Estimated amount you owe',
    amount: dollars(Math.abs(resultCents)),
    kind: 'result',
  });

  // --- Checks on the W-2s --------------------------------------------------
  input.w2s.forEach((w, index) => {
    const name = w.employer || `W-2 #${index + 1}`;
    const expectedSs = Math.round(Math.min(cents(w.socialSecurityWages), cents(table.socialSecurityWageBase)) * SOCIAL_SECURITY_RATE);
    if (Math.abs(cents(w.socialSecurityWithheld) - expectedSs) > 100) {
      notes.push(`${name}: box 4 ($${w.socialSecurityWithheld.toLocaleString()}) is not 6.2% of box 3 ($${dollars(expectedSs).toLocaleString()} expected). Check the numbers were copied correctly.`);
    }
    if (w.socialSecurityWages > table.socialSecurityWageBase) {
      notes.push(`${name}: box 3 is above the ${input.year} Social Security wage base ($${table.socialSecurityWageBase.toLocaleString()}). Check box 3.`);
    }
    const medicare = cents(w.medicareWages);
    const expectedMedicare = Math.round(medicare * MEDICARE_RATE) + Math.round(Math.max(0, medicare - cents(200_000)) * ADDITIONAL_MEDICARE_RATE);
    if (Math.abs(cents(w.medicareWithheld) - expectedMedicare) > 100) {
      notes.push(`${name}: box 6 ($${w.medicareWithheld.toLocaleString()}) is not what 1.45% of box 5 gives ($${dollars(expectedMedicare).toLocaleString()} expected). Check the numbers were copied correctly.`);
    }
  });
  const eitcRange = input.qualifyingChildren > 0 ? 70_000 : 20_000;
  if (dollars(agiCents) < eitcRange) {
    notes.push('At this income you may qualify for the earned income credit, which this estimate does not include. It would increase your refund.');
  }

  return {
    ok: true,
    year: input.year,
    lines,
    refundOrOwed: dollars(resultCents),
    totalTax: dollars(totalTaxCents),
    totalPayments: dollars(totalPaymentsCents),
    notes,
    notIncluded: NOT_INCLUDED,
    sources: table.sources,
  };
}
