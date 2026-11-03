import { describe, it, expect } from 'vitest';
import { parseCsvRecords } from '../csv';

/**
 * The Finance page split CSV lines on every comma, so "10,000.00" became a
 * debit of 10 and a credit of 000.00.
 */
describe('parseCsvRecords', () => {
  it('keeps a quoted amount with a thousands separator in one cell', () => {
    expect(parseCsvRecords('Account,Debit,Credit\nCash,"10,000.00",\n')).toEqual([
      ['Account', 'Debit', 'Credit'],
      ['Cash', '10,000.00', ''],
    ]);
  });

  it('handles escaped quotes, newlines inside quotes, CRLF and a byte-order mark', () => {
    const text = '﻿Name,Note\r\n"Smith, J","said ""hi""\nthen left"\r\nDoe,ok';
    expect(parseCsvRecords(text)).toEqual([
      ['Name', 'Note'],
      ['Smith, J', 'said "hi"\nthen left'],
      ['Doe', 'ok'],
    ]);
  });

  it('skips empty lines and keeps empty trailing fields', () => {
    expect(parseCsvRecords('a,b,c\n\n1,,\n')).toEqual([['a', 'b', 'c'], ['1', '', '']]);
  });
});
