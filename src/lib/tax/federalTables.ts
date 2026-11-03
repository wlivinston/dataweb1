// Federal income tax figures, by tax year, each with its source.
//
// Every number here was checked against an IRS (or, for the wage base, SSA)
// publication, not taken from memory. A year that is not here is refused: the
// estimate never extrapolates a table. When a new year's Revenue Procedure is
// out, add the year with its citations and hand-worked cases in
// taxFederal.test.ts.

export type FilingStatus = 'single' | 'married_joint' | 'married_separate' | 'head_of_household' | 'surviving_spouse';

/** Upper limit of each bracket (the last is Infinity), for rates 10..37%. */
export type Brackets = readonly [number, number, number, number, number, number, number];

export const RATES = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37] as const;

export interface FederalYear {
  year: number;
  /** Ordinary income brackets. Surviving spouse uses the joint table. */
  brackets: Record<Exclude<FilingStatus, 'surviving_spouse'>, Brackets>;
  standardDeduction: Record<Exclude<FilingStatus, 'surviving_spouse'>, number>;
  /** Extra standard deduction per condition (65+, blind): married/surviving vs unmarried. */
  additionalStandardDeduction: { married: number; unmarried: number };
  /** Enhanced deduction for seniors (2025-2028), per person aged 65+. */
  seniorDeduction: { perPerson: number; phaseOutStart: { joint: number; other: number }; phaseOutRate: number } | null;
  childTaxCredit: { perChild: number; refundablePerChild: number; otherDependent: number; phaseOutStart: { joint: number; other: number } };
  /** Social Security (OASDI) wage base. */
  socialSecurityWageBase: number;
  sources: string[];
}

const INF = Number.POSITIVE_INFINITY;

export const FEDERAL_YEARS: Record<number, FederalYear> = {
  2025: {
    year: 2025,
    brackets: {
      single: [11_925, 48_475, 103_350, 197_300, 250_525, 626_350, INF],
      married_joint: [23_850, 96_950, 206_700, 394_600, 501_050, 751_600, INF],
      married_separate: [11_925, 48_475, 103_350, 197_300, 250_525, 375_800, INF],
      head_of_household: [17_000, 64_850, 103_350, 197_300, 250_500, 626_350, INF],
    },
    // OBBBA (P.L. 119-21) raised the 2025 amounts that Rev. Proc. 2024-40 had set.
    standardDeduction: { single: 15_750, married_joint: 31_500, married_separate: 15_750, head_of_household: 23_625 },
    additionalStandardDeduction: { married: 1_600, unmarried: 2_000 },
    seniorDeduction: { perPerson: 6_000, phaseOutStart: { joint: 150_000, other: 75_000 }, phaseOutRate: 0.06 },
    childTaxCredit: { perChild: 2_200, refundablePerChild: 1_700, otherDependent: 500, phaseOutStart: { joint: 400_000, other: 200_000 } },
    socialSecurityWageBase: 176_100,
    sources: [
      'Brackets: Rev. Proc. 2024-40; IRS "Federal income tax rates and brackets"',
      'Standard deduction: IRS "How to update withholding to account for tax law changes for 2025"; Pub. 554 (2025)',
      'Additional standard deduction (65+/blind): IRS Topic 551',
      'Senior deduction: IRS newsroom "Check your eligibility for the new enhanced deduction for seniors"; Schedule 1-A lines 33-35',
      'Child tax credit: IRS "Tax credits for individuals" (2025: $2,200, up to $1,700 refundable)',
      'Social Security wage base: SSA Contribution and Benefit Base ($176,100)',
    ],
  },
  2026: {
    year: 2026,
    brackets: {
      single: [12_400, 50_400, 105_700, 201_775, 256_225, 640_600, INF],
      married_joint: [24_800, 100_800, 211_400, 403_550, 512_450, 768_700, INF],
      married_separate: [12_400, 50_400, 105_700, 201_775, 256_225, 384_350, INF],
      head_of_household: [17_700, 67_450, 105_700, 201_750, 256_200, 640_600, INF],
    },
    standardDeduction: { single: 16_100, married_joint: 32_200, married_separate: 16_100, head_of_household: 24_150 },
    additionalStandardDeduction: { married: 1_650, unmarried: 2_050 },
    seniorDeduction: { perPerson: 6_000, phaseOutStart: { joint: 150_000, other: 75_000 }, phaseOutRate: 0.06 },
    childTaxCredit: { perChild: 2_200, refundablePerChild: 1_700, otherDependent: 500, phaseOutStart: { joint: 400_000, other: 200_000 } },
    socialSecurityWageBase: 184_500,
    sources: [
      'Brackets, standard deduction, additional standard deduction, child tax credit: Rev. Proc. 2025-32; Pub. 505 (2026) Schedules X-Z',
      'Senior deduction (2025-2028): IRS newsroom; Schedule 1-A',
      'Social Security wage base: SSA Contribution and Benefit Base ($184,500)',
    ],
  },
};

/** Statutory, not indexed. */
export const SOCIAL_SECURITY_RATE = 0.062;
export const MEDICARE_RATE = 0.0145;
export const ADDITIONAL_MEDICARE_RATE = 0.009;
/** Form 8959 thresholds. */
export const ADDITIONAL_MEDICARE_THRESHOLD: Record<FilingStatus, number> = {
  single: 200_000, head_of_household: 200_000, surviving_spouse: 200_000, married_joint: 250_000, married_separate: 125_000,
};
/** Employers withhold Additional Medicare Tax on wages above this, whatever the filing status. */
export const ADDITIONAL_MEDICARE_WITHHOLDING_THRESHOLD = 200_000;

/** Below this taxable income Form 1040 requires the Tax Table, not the rate schedule. */
export const TAX_TABLE_LIMIT = 100_000;
/** Additional child tax credit: 15% of earned income above this (Schedule 8812). */
export const ACTC_EARNED_INCOME_FLOOR = 2_500;
export const ACTC_RATE = 0.15;
