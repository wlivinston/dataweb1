import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractTextItems, type PdfJsLike } from '../tax/w2Pdf'
import { parseW2, type W2BoxKey } from '../tax/w2Parse'

// W-2 PDFs built with jsPDF in the layouts payroll systems use, then read
// back through pdf.js - the same extraction the browser runs - so these test
// real PDF text positions, not hand-made items.

type Values = Record<W2BoxKey, string>
const VALUES: Values = {
  wages: '60,000.00',
  federalWithheld: '6,000.00',
  socialSecurityWages: '61,500.00',
  socialSecurityWithheld: '3,813.00',
  medicareWages: '61,500.00',
  medicareWithheld: '891.75',
}
const EXPECTED = { wages: 60000, federalWithheld: 6000, socialSecurityWages: 61500, socialSecurityWithheld: 3813, medicareWages: 61500, medicareWithheld: 891.75 }

const LABEL: Record<W2BoxKey, string> = {
  wages: '1 Wages, tips, other compensation',
  federalWithheld: '2 Federal income tax withheld',
  socialSecurityWages: '3 Social security wages',
  socialSecurityWithheld: '4 Social security tax withheld',
  medicareWages: '5 Medicare wages and tips',
  medicareWithheld: '6 Medicare tax withheld',
}

const read = async (doc: jsPDF) => {
  const data = new Uint8Array(doc.output('arraybuffer'))
  return parseW2(await extractTextItems(data, pdfjs as unknown as PdfJsLike))
}

/** The IRS grid: label at the top of each cell, amount beneath it. */
function drawGridCopy(doc: jsPDF, top: number, values: Values, align: 'left' | 'right') {
  const cell = (x: number, y: number, label: string, value?: string) => {
    doc.rect(x, y, 150, 30)
    doc.setFontSize(6); doc.text(label, x + 3, y + 8)
    if (value) {
      doc.setFontSize(10)
      if (align === 'left') doc.text(value, x + 6, y + 23)
      else doc.text(value, x + 146, y + 23, { align: 'right' })
    }
  }
  doc.setFontSize(6); doc.text("a Employee's social security number", 40, top - 22)
  doc.setFontSize(10); doc.text('123-45-6789', 46, top - 10)
  cell(40, top, LABEL.wages, values.wages)
  cell(190, top, LABEL.federalWithheld, values.federalWithheld)
  cell(40, top + 30, LABEL.socialSecurityWages, values.socialSecurityWages)
  cell(190, top + 30, LABEL.socialSecurityWithheld, values.socialSecurityWithheld)
  cell(40, top + 60, LABEL.medicareWages, values.medicareWages)
  cell(190, top + 60, LABEL.medicareWithheld, values.medicareWithheld)
  cell(40, top + 90, '7 Social security tips', '250.00')
  cell(190, top + 90, '8 Allocated tips', '0.00')
  doc.setFontSize(6); doc.text("c Employer's name, address, and ZIP code", 40, top + 135)
  doc.setFontSize(9); doc.text('Acme Hardware Inc', 46, top + 147); doc.text('12 Main St, Accra', 46, top + 158)
  doc.setFontSize(8); doc.text('Form W-2 Wage and Tax Statement', 360, top + 10)
  doc.setFontSize(20); doc.text('2025', 360, top + 40)
}

const gridPdf = (copies: Values[], align: 'left' | 'right' = 'left') => {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  copies.forEach((values, i) => drawGridCopy(doc, 60 + i * 370, values, align))
  return doc
}

describe('reading a W-2 PDF', () => {
  it('the IRS grid, two copies: every box, agreed by both copies; employer and year', async () => {
    const r = await read(gridPdf([VALUES, VALUES]))
    if (!r.ok) throw new Error(r.reason)
    for (const [key, value] of Object.entries(EXPECTED)) {
      expect([key, r.boxes[key as W2BoxKey]?.value, r.boxes[key as W2BoxKey]?.confidence]).toEqual([key, value, 'agreed'])
    }
    expect(r.copies).toBe(2)
    expect(r.year).toBe(2025)
    expect(r.employer).toBe('Acme Hardware Inc')
    expect(r.notes).toEqual([])
  })

  it('amounts right-aligned in their cells', async () => {
    const r = await read(gridPdf([VALUES], 'right'))
    if (!r.ok) throw new Error(r.reason)
    expect(Object.fromEntries(Object.entries(r.boxes).map(([k, v]) => [k, v!.value]))).toEqual(EXPECTED)
  })

  it('a payroll layout with each amount on its label\'s line', async () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    doc.setFontSize(14); doc.text('2025 W-2 Wage and Tax Statement', 40, 50)
    doc.setFontSize(9); doc.text("Employer's name, address, and ZIP code", 40, 80)
    doc.text('Gold Coast Logistics Ltd', 40, 92)
    ;(Object.keys(LABEL) as W2BoxKey[]).forEach((key, i) => {
      doc.text(LABEL[key], 40, 130 + i * 18)
      doc.text(VALUES[key], 560, 130 + i * 18, { align: 'right' })
    })
    const r = await read(doc)
    if (!r.ok) throw new Error(r.reason)
    expect(Object.fromEntries(Object.entries(r.boxes).map(([k, v]) => [k, v!.value]))).toEqual(EXPECTED)
    expect(r.employer).toBe('Gold Coast Logistics Ltd')
    expect(r.year).toBe(2025)
  })

  it('copies that disagree are flagged, not silently resolved', async () => {
    const r = await read(gridPdf([VALUES, { ...VALUES, federalWithheld: '6,500.00' }]))
    if (!r.ok) throw new Error(r.reason)
    expect(r.boxes.federalWithheld?.confidence).toBe('conflict')
    expect(r.boxes.federalWithheld?.seen.sort()).toEqual([6000, 6500])
    expect(r.notes.some(n => n.startsWith('Box 2') && n.includes('disagree'))).toBe(true)
    expect(r.boxes.wages?.confidence).toBe('agreed')
  })

  it('a missing amount is left empty, never taken from a neighbouring box', async () => {
    const r = await read(gridPdf([{ ...VALUES, socialSecurityWithheld: '' }]))
    if (!r.ok) throw new Error(r.reason)
    expect(r.boxes.socialSecurityWithheld).toBeUndefined()
    expect(r.notes).toContain('Box 4 was not found. Type it in from your W-2.')
    // and box 7's 250.00 / box 8's 0.00 never land in boxes 3-6
    expect(r.boxes.medicareWithheld?.value).toBe(891.75)
  })

  it('in a compact grid, an amount belongs to the nearest label, not the first in reach', async () => {
    // 22pt rows: box 6's amount is within reach of box 4's label too.
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    doc.setFontSize(8); doc.text('Form W-2 Wage and Tax Statement 2025', 360, 50)
    const cell = (x: number, y: number, label: string, value?: string) => {
      doc.setFontSize(6); doc.text(label, x + 3, y + 7)
      if (value) { doc.setFontSize(9); doc.text(value, x + 6, y + 17) }
    }
    cell(40, 60, LABEL.wages, VALUES.wages); cell(190, 60, LABEL.federalWithheld, VALUES.federalWithheld)
    cell(40, 82, LABEL.socialSecurityWages, VALUES.socialSecurityWages); cell(190, 82, LABEL.socialSecurityWithheld)
    cell(40, 104, LABEL.medicareWages, VALUES.medicareWages); cell(190, 104, LABEL.medicareWithheld, VALUES.medicareWithheld)
    const r = await read(doc)
    if (!r.ok) throw new Error(r.reason)
    expect(r.boxes.socialSecurityWithheld).toBeUndefined()
    expect(r.boxes.medicareWithheld?.value).toBe(891.75)
    expect(r.boxes.federalWithheld?.value).toBe(6000)
  })

  it('a label split into several text pieces is still found', async () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    doc.setFontSize(9); doc.text('W-2 Wage and Tax Statement', 40, 50)
    doc.text('1 Wages, tips,', 40, 100)
    doc.text('other compensation', 40 + doc.getTextWidth('1 Wages, tips,') + 6, 100)
    doc.text('60,000.00', 500, 100, { align: 'right' })
    const r = await read(doc)
    if (!r.ok) throw new Error(r.reason)
    expect(r.boxes.wages?.value).toBe(60000)
  })

  it('a pay stub with W-2-like labels but no W-2 title is refused', async () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    doc.setFontSize(10); doc.text('Earnings Statement - year to date', 40, 50)
    doc.text('Wages, tips, other compensation', 40, 100); doc.text('41,000.00', 400, 100)
    const r = await read(doc)
    expect(r.ok).toBe(false)
  })

  it('never reads the Social Security number as an amount', async () => {
    const r = await read(gridPdf([VALUES]))
    if (!r.ok) throw new Error(r.reason)
    expect(JSON.stringify(r)).not.toContain('6789')
  })

  it('a scan (no text) is refused', async () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    doc.rect(40, 40, 300, 200)
    const r = await read(doc)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('no text')
  })

  it('a PDF that is not a W-2 is refused', async () => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    doc.setFontSize(12); doc.text('Invoice 1042', 40, 60); doc.text('Total due 1,250.00', 40, 80)
    const r = await read(doc)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('does not look like a W-2')
  })
})
