import { describe, it, expect } from 'vitest';
import { makeDataset, seededRandom } from './fixtures';
import { autoAdvancedAnalysis } from '../advancedStatistics';
import { isAdditiveColumn, isIdentifierLike } from '../columnMeaning';

/**
 * Which columns Advanced Stats analyses on its own.
 *
 * It took the first text and first numeric columns as given, and on a study
 * of participants reported "162 of 240 participant ids account for 80% of
 * total age" and a regression predicting age from scores.
 */

const random = seededRandom(11);

const participants = makeDataset(
  Array.from({ length: 60 }, (_, i) => {
    const baseline = 40 + Math.floor(random() * 40);
    return {
      participant_id: `P${String(i + 1).padStart(4, '0')}`,
      study_group: i % 2 ? 'Workshop' : 'Self-study',
      age: 20 + Math.floor(random() * 45),
      baseline_score: baseline,
      // Follows baseline closely; age is noise.
      followup_score: baseline + 5 + Math.floor(random() * 6),
    };
  }),
  [
    { name: 'participant_id', type: 'string' },
    { name: 'study_group', type: 'string' },
    { name: 'age', type: 'number' },
    { name: 'baseline_score', type: 'number' },
    { name: 'followup_score', type: 'number' },
  ],
  { id: 'p', name: 'participants' }
);

describe('Advanced Stats column choice', () => {
  it('runs no Pareto on ids or on values that do not add up', () => {
    expect(autoAdvancedAnalysis(participants).pareto).toEqual([]);
  });

  it('predicts the measure the others explain best, not the first column', () => {
    const { regression } = autoAdvancedAnalysis(participants);
    // baseline and followup explain each other almost equally; age explains nothing.
    expect(['baseline_score', 'followup_score']).toContain(regression?.targetColumn);
    expect(regression?.predictorColumns).not.toContain('participant_id');
  });

  it('still runs a Pareto of revenue by region', () => {
    const sales = makeDataset(
      Array.from({ length: 40 }, (_, i) => ({ region: ['North', 'South', 'East', ' north '][i % 4], revenue: 10 + i })),
      [{ name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }],
      { id: 's', name: 'sales' }
    );
    const [pareto] = autoAdvancedAnalysis(sales).pareto;
    expect(pareto.column).toBe('region');
    // " north " groups with "North", as the engine groups.
    expect(pareto.items.map(item => item.category).sort()).toEqual(['East', 'North', 'South']);
  });

  it('recognises ids and additive columns', () => {
    expect(isIdentifierLike('participant_id', [])).toBe(true);
    expect(isIdentifierLike('OrderNumber', [])).toBe(true);
    expect(isIdentifierLike('label', Array.from({ length: 20 }, (_, i) => `v${i}`))).toBe(true);
    expect(isIdentifierLike('study_group', Array.from({ length: 20 }, (_, i) => (i % 2 ? 'A' : 'B')))).toBe(false);
    expect(isAdditiveColumn('Revenue')).toBe(true);
    expect(isAdditiveColumn('age')).toBe(false);
  });
});
