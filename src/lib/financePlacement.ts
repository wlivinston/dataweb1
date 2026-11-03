// Moving a line to another statement, on the user's say-so.
//
// The report lists where every account went and why (LinePlacement). When a
// line was placed by guesswork, or by a name that reads two ways, the user
// can move it. This applies those choices to the journal before the report
// is run again.

import type { AccountCategory } from './financeTypes';
import type { CanonicalTransaction } from './financeImportPipeline';

/** Categories whose balance is normally a credit. */
const CREDIT_NORMAL = new Set<AccountCategory>([
  'revenue', 'other_income', 'current_liability', 'non_current_liability', 'equity', 'contra_asset',
]);

export const normalSideOf = (category: AccountCategory): 'debit' | 'credit' =>
  CREDIT_NORMAL.has(category) ? 'credit' : 'debit';

/**
 * The journal with each overridden account's lines moved to the chosen
 * category. Setting the category to the engine's own name makes it an exact
 * hint, so no name rule can move it back.
 *
 * A line imported from a single Amount column has no debit/credit of its
 * own: its side was inferred for the category it was first given. Moved, it
 * takes the new category's normal side (the opposite side when the amount
 * was negative), so "Delivery Fees 1,250" moved from expense to revenue is
 * 1,250 of revenue, not -1,250. Lines from Debit/Credit columns keep the
 * side the file gave them.
 */
export function applyPlacementOverrides(
  journal: CanonicalTransaction[],
  overrides: Record<string, AccountCategory>
): CanonicalTransaction[] {
  return journal.map(row => {
    const target = overrides[row.Account];
    if (!target) return row;
    const moved: CanonicalTransaction = { ...row, Category: target };
    if (row.Flags?.includes('single_amount')) {
      const amount = Math.max(row.Debit || 0, row.Credit || 0);
      const negative = row.Flags.includes('negative_value_normalized');
      const normal = normalSideOf(target);
      const side = negative ? (normal === 'debit' ? 'credit' : 'debit') : normal;
      moved.Debit = side === 'debit' ? amount : 0;
      moved.Credit = side === 'credit' ? amount : 0;
      moved.Type = side === 'credit' ? 'Income' : 'Expense';
    }
    return moved;
  });
}
