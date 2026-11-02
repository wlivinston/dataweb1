import { describe, it, expect } from 'vitest';
import { makeDataset } from './fixtures';
import { buildSemanticModel } from '../semantic/model';
import { answerQuestion } from '../nlq';
import { sumByCategory, numbersIn, coverageNote, BLANK_LABEL, CategoryGroups } from '../chartValues';
import {
  toHeatmapCorrelation, toStackedBarData, toRadarData, toBubbleData, toStatsSummaryTable,
  toTreemapData, toParetoData,
} from '../chartRecommender';
import { toRadarRenderData, radarSeriesKeys } from '../visualizationRenderer';

/**
 * What a chart draws for messy cells.
 *
 * The rows below are the faults found in a real upload (practice_workbook.xlsx):
 * " workshop " beside "Workshop", "NA" in a score column, a blank category.
 * Charts read them their own way and disagreed with the engine and Ask Data;
 * these tests pin the chart side to the engine's rules.
 */

const participants = [
  { study_group: 'Workshop', baseline_score: 48 },
  { study_group: 'Self-study', baseline_score: 56 },
  { study_group: ' workshop ', baseline_score: 49 },
  { study_group: 'Workshop', baseline_score: 'NA' },
  { study_group: '', baseline_score: 10 },
  { study_group: 'Self-study', baseline_score: '' },
];

describe('grouping by category', () => {
  it('" workshop " and "Workshop" are one group, labelled as first seen', () => {
    const totals = sumByCategory(participants, 'study_group', 'baseline_score');
    expect(totals.map(t => t.category)).toEqual(['Workshop', 'Self-study', BLANK_LABEL]);
    expect(totals.find(t => t.category === 'Workshop')?.value).toBe(97);
  });

  it('a blank category is "(Blank)", not "Other" - the name of the small-slices bucket', () => {
    const totals = sumByCategory(participants, 'study_group', 'baseline_score');
    expect(totals.map(t => t.category)).not.toContain('Other');
    expect(totals.find(t => t.category === BLANK_LABEL)?.value).toBe(10);
  });

  it('"NA" and an empty cell add nothing and are not counted', () => {
    const totals = sumByCategory(participants, 'study_group', 'baseline_score');
    // Two numeric Workshop rows, not three; one Self-study row, not two.
    expect(totals.find(t => t.category === 'Workshop')?.count).toBe(2);
    expect(totals.find(t => t.category === 'Self-study')?.count).toBe(1);
  });

  it('keeps a category label "0" that `|| "Other"` used to rename', () => {
    const groups = new CategoryGroups();
    expect(groups.label(groups.key(0))).toBe('0');
  });

  it('agrees with Ask Data, which answers through the DAX engine', () => {
    const dataset = makeDataset(
      participants,
      [{ name: 'study_group', type: 'string' }, { name: 'baseline_score', type: 'number' }],
      { id: 'ds-p', name: 'participants' }
    );
    const answer = answerQuestion('total baseline_score by study_group', buildSemanticModel([dataset]));
    if (!answer.ok || answer.shape !== 'table') throw new Error('expected a table answer');

    const engine = new Map(
      answer.rows.map(([group, value]) => [group === null ? BLANK_LABEL : String(group).trim().toLowerCase(), value])
    );
    for (const total of sumByCategory(participants, 'study_group', 'baseline_score')) {
      const key = total.category === BLANK_LABEL ? BLANK_LABEL : total.category.toLowerCase();
      expect([key, engine.get(key)]).toEqual([key, total.value]);
    }
    expect(engine.size).toBe(3);
  });
});

describe('numbers', () => {
  it('a blank is left out, never read as 0', () => {
    expect(numbersIn([{ v: 5 }, { v: '' }, { v: null }, { v: 'NA' }, { v: '7' }], 'v')).toEqual([5, 7]);
  });

  it('the statistical summary counts values, not rows', () => {
    const [summary] = toStatsSummaryTable([{ v: 10 }, { v: '' }, { v: 20 }, { v: null }], ['v']);
    expect(summary.Count).toBe(2);
    expect(summary.Min).toBe(10);
    expect(summary.Mean).toBe(15);
  });
});

describe('correlation', () => {
  it('a blank does not drag a correlation toward zero', () => {
    // b is exactly 2a wherever both exist. Read as 0, the blank row is a
    // (0, 100) point that wrecks the relationship.
    const rows = [
      { a: 1, b: 2, c: 5 }, { a: 2, b: 4, c: 3 }, { a: 3, b: 6, c: 9 },
      { a: 4, b: 8, c: 1 }, { a: '', b: 100, c: 4 },
    ];
    const matrix = toHeatmapCorrelation(rows, ['a', 'b', 'c']);
    expect(matrix[0].b).toBe(1);
  });
});

describe('points', () => {
  it('a bubble with a missing coordinate or size is not drawn at 0', () => {
    const rows = [
      { x: 1, y: 2, z: 3 }, { x: '', y: 5, z: 1 }, { x: 4, y: 'NA', z: 1 }, { x: 6, y: 7, z: null },
    ];
    expect(toBubbleData(rows, 'x', 'y', 'z')).toEqual([{ x: 1, y: 2, z: 3, label: '' }]);
  });
});

describe('stacked bars', () => {
  it('a blank status is a series called "(Blank)", not a nameless legend swatch', () => {
    const rows = [
      { cart: 'Adult', status: 'ACTIVE', days: 10 },
      { cart: 'Adult', status: '', days: 4 },
      { cart: 'adult ', status: 'EXPIRED', days: 1 },
    ];
    const [adult, ...others] = toStackedBarData(rows, 'cart', 'status', 'days');
    expect(others).toHaveLength(0);
    expect(adult).toEqual({ category: 'Adult', ACTIVE: 10, [BLANK_LABEL]: 4, EXPIRED: 1 });
    expect(Object.keys(adult)).not.toContain('');
  });
});

describe('treemap and pareto', () => {
  it('merge spelling variants and leave a category with no numbers out of the boxes', () => {
    const rows = [
      { t: 'Adult', v: 5 }, { t: ' adult', v: 5 }, { t: 'Neonatal', v: 3 }, { t: 'Pediatric', v: '' },
    ];
    expect(toTreemapData(rows, 't', 'v').map(e => [e.name, e.size])).toEqual([['Adult', 10], ['Neonatal', 3]]);
    expect(toParetoData(rows, 't', 'v').map(e => e.category)).toEqual(['Adult', 'Neonatal']);
  });
});

describe('radar', () => {
  const rows = [
    { cart: 'Adult', held: 10, expire: 30, med: 20 },
    { cart: ' adult ', held: 20, expire: 'NA', med: 40 },
    { cart: 'Neonatal', held: 4, expire: 10, med: 6 },
  ];

  it('averages each measure per category, blanks not averaged in', () => {
    const data = toRadarData(rows, ['held', 'expire', 'med'], 'cart', ['Adult', 'Neonatal']);
    expect(data.find(d => d.subject === 'held')).toEqual({ subject: 'held', Adult: 15, Neonatal: 4 });
    expect(data.find(d => d.subject === 'expire')).toEqual({ subject: 'expire', Adult: 30, Neonatal: 10 });
  });

  it('the renderer keeps each category as a series, so the shapes are drawn', () => {
    const data = toRadarData(rows, ['held', 'expire', 'med'], 'cart', ['Adult', 'Neonatal']);
    const rendered = toRadarRenderData(data);
    expect(radarSeriesKeys(rendered)).toEqual(['Adult', 'Neonatal']);
    expect(rendered[0]).toMatchObject({ subject: 'held', Adult: 15, Neonatal: 4 });
  });
});

describe('the description under each chart', () => {
  it('says how many rows were used and how many were left out, and why', () => {
    expect(coverageNote(participants, ['baseline_score'])).toBe(
      'Drawn from 6 rows. 2 rows with a blank or non-numeric baseline_score are left out.'
    );
  });

  it('says when the chart was drawn from a sample', () => {
    expect(coverageNote([{ v: 1 }, { v: 2 }], ['v'], 50_000)).toBe('Drawn from a sample of 2 of 50,000 rows.');
  });

  it('says nothing about left-out rows when there are none', () => {
    expect(coverageNote([{ v: 1 }], ['v'])).toBe('Drawn from 1 row.');
  });
});
