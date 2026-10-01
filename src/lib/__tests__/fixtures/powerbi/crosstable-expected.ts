import type { ParityCase } from './expected';

/**
 * Ground truth from Power BI for figures that CROSS A RELATIONSHIP.
 *
 * Every other sheet in this folder asks one table a question. This one asks
 * two, which is the shape of the question the NLQ layer refused outright
 * until 2026-10-01 - "total Revenue by Country", where Revenue is in Orders
 * and Country is in Customers.
 *
 * The refusal was right about the danger and wrong about the scope. Crossing
 * a join is correct when the filter TRAVELS: a customer dimension narrows an
 * orders fact, so each country gets its own figure. Asked the other way
 * round it does not travel, every group receives the grand total, and the
 * result looks like an ordinary breakdown while meaning nothing. Case
 * `grouping-the-wrong-way-round-...` is here to establish that Power BI
 * behaves the same way, because the refusal that remains is built on it - if
 * Power BI returned something else, this engine would be refusing a question
 * Power BI answers.
 *
 * Runs against orders.csv JOINED to customers.csv on CustomerID. The join is
 * the fixture: load both tables and let Power BI detect the relationship, or
 * create it as Orders[CustomerID] -> Customers[CustomerID], many to one,
 * single direction. `canary-the-join-exists` fails loudly if it is missing,
 * because without it every figure below is the grand total and they all look
 * perfectly plausible.
 *
 * The data, hand-computable throughout:
 *
 *   Orders    C1: 100 + 200 + 400 = 700
 *             C2: 300 + 600       = 900
 *             C3: 500             = 500
 *                 total           = 2100, over 6 rows
 *
 *   Customers C1 Ama   Ghana Retail    1000
 *             C2 Kofi  Kenya Retail    2000
 *             C3 Yaa   Ghana Wholesale    0
 *             C4 Kwame Kenya Wholesale  500   <- no orders at all
 *                 total credit = 3500, over 4 rows
 *
 *   so Ghana 1200, Kenya 900; Retail 1600, Wholesale 500.
 */

/** Revenue per country: the grouping the product now allows. */
const BY_COUNTRY =
  'ADDCOLUMNS(VALUES(Customers[Country]), "T", CALCULATE(SUM(Orders[Revenue])))';

/** Revenue per customer, including the one who bought nothing. */
const BY_NAME = 'ADDCOLUMNS(VALUES(Customers[Name]), "T", CALCULATE(SUM(Orders[Revenue])))';

/** The same shape pointed the wrong way: a dimension figure per fact value. */
const BY_PRODUCT =
  'ADDCOLUMNS(VALUES(Orders[ProductID]), "T", CALCULATE(SUM(Customers[CreditLimit])))';

export const CROSSTABLE_CASES: ParityCase[] = [
  {
    id: 'canary-the-join-exists',
    probes:
      'Ghana revenue with the relationship in place is 1200. WITHOUT the ' +
      'relationship the filter does nothing and this returns 2100, the grand ' +
      'total - a number that looks like an answer. Nothing below this line ' +
      'means anything unless this is 1200.',
    dax: 'CALCULATE(SUM(Orders[Revenue]), Customers[Country] = "Ghana")',
    expected: null,
  },
  {
    id: 'canary-both-tables-loaded',
    probes:
      'Six orders against four customers. A sheet read off a half-loaded ' +
      'model answers consistently and wrongly.',
    dax: 'COUNTROWS(Orders) * 10 + COUNTROWS(Customers)',
    expected: null,
  },
  {
    id: 'revenue-by-country',
    probes:
      'The whole question this sheet exists for, flattened into one string so ' +
      'which groups exist and what each totals both travel in one answer. ' +
      'Ghana 1200 is two customers added together, which is the part a join ' +
      'that half works would get wrong.',
    dax: `CONCATENATEX(${BY_COUNTRY}, Customers[Country] & "=" & [T], ">")`,
    expected: null,
    returnsText: true,
    unorderedText: true,
  },
  {
    id: 'revenue-by-segment',
    probes:
      'The same crossing by a different dimension column, so the result ' +
      'cannot be an accident of Country. Retail 1600, Wholesale 500 - and ' +
      'Wholesale is 500 only if the customer with no orders contributes ' +
      'nothing rather than removing the group.',
    dax:
      'CONCATENATEX(ADDCOLUMNS(VALUES(Customers[Segment]), "T", ' +
      'CALCULATE(SUM(Orders[Revenue]))), Customers[Segment] & "=" & [T], ">")',
    expected: null,
    returnsText: true,
    unorderedText: true,
  },
  {
    id: 'a-group-with-no-rows-behind-it',
    probes:
      'Kwame is a customer with no orders. Does he appear with a blank, or ' +
      'vanish? The difference is "this customer bought nothing" against ' +
      '"this customer does not exist", and a breakdown that quietly drops ' +
      'him is wrong in a way that looks fine. The blank is written out ' +
      'explicitly so a missing row and a blank row cannot read the same.',
    dax:
      `CONCATENATEX(${BY_NAME}, Customers[Name] & "=" & ` +
      'IF(ISBLANK([T]), "(blank)", [T]), ">")',
    expected: null,
    returnsText: true,
    unorderedText: true,
  },
  {
    id: 'how-many-groups-when-one-has-no-rows',
    probes:
      'Four customers, three with orders. Counted as well as listed because ' +
      'the count answers the vanishing question on its own, without ' +
      'depending on how a blank renders inside CONCATENATEX.',
    dax: `COUNTROWS(${BY_NAME})`,
    expected: null,
  },
  {
    id: 'grouping-the-wrong-way-round-gives-every-group-the-same-figure',
    probes:
      'THE CASE THE REFUSAL RESTS ON. Credit limit lives on the ONE side and ' +
      'ProductID on the MANY side, so filtering Orders cannot narrow ' +
      'Customers and every product should show the identical 3500. If Power ' +
      'BI instead returns three different figures, it is following the join ' +
      'in a direction this engine does not, and the refusal is wrong rather ' +
      'than protective. Three identical numbers is the answer that confirms ' +
      'refusing is right.',
    dax: `CONCATENATEX(${BY_PRODUCT}, Orders[ProductID] & "=" & [T], ">")`,
    expected: null,
    returnsText: true,
    unorderedText: true,
  },
  {
    id: 'filtering-the-fact-leaves-the-dimension-whole',
    probes:
      'The same one-way rule on the same measure the case above grouped, so ' +
      'the two isolate each other: this one asks whether the filter travels ' +
      'back at all, without any grouping involved. Two orders exceed 400 and ' +
      'they belong to C2 and C3, whose limits are 2000 and 0. A ' +
      'single-direction relationship does not carry the filter back, so the ' +
      'answer should be the whole 3500. A 2000 here would mean the ' +
      'relationship is bidirectional after all, and then the wrong-way ' +
      'grouping above is meaningful and refusing it is wrong.',
    dax: 'CALCULATE(SUM(Customers[CreditLimit]), Orders[Revenue] > 400)',
    expected: null,
  },
  {
    id: 'every-order-reaches-a-group',
    probes:
      'The rows of Orders summed over the country groups. Equal to ' +
      'COUNTROWS(Orders) only when every order joins to a customer; any ' +
      'order whose CustomerID matched nothing would be missing from the ' +
      'breakdown while the breakdown still looked complete. This is the ' +
      'figure the product reports to the reader when it is short.',
    dax: 'SUMX(VALUES(Customers[Country]), CALCULATE(COUNTROWS(Orders)))',
    expected: null,
  },
  {
    id: 'the-largest-country',
    probes:
      'A single row, so the answer cannot depend on how TOPN orders what it ' +
      'returns - the question that cost this repo a week on the table sheet.',
    dax: `CONCATENATEX(TOPN(1, ${BY_COUNTRY}, [T], DESC), Customers[Country], ">")`,
    expected: null,
    returnsText: true,
  },
  {
    id: 'a-zero-on-the-dimension-is-a-value',
    probes:
      "Yaa's credit limit is a genuine 0, not a missing one. MIN should be 0 " +
      'and not 500. The same confusion on the Excel import path turned every ' +
      'zero in an uploaded workbook into a blank.',
    dax: 'MIN(Customers[CreditLimit])',
    expected: null,
  },
];

export const pendingCrossTableCount = (): number =>
  CROSSTABLE_CASES.filter(entry => entry.expected === null).length;
