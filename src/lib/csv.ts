// CSV text to records, honouring quotes.
//
// The Finance page split each line on every comma, so the most common
// accounting export - quoted thousands, "10,000.00" - became two cells: a
// debit of 10 and a credit of 000.00. Every figure built on it was wrong
// before any arithmetic ran. This is the quote-aware reader the main upload
// page already used, moved here so both pages share it.

/**
 * The records of a CSV text: quoted fields may hold commas, quotes ("" inside
 * quotes) and newlines; CRLF, LF and lone CR all end a row; a byte-order mark
 * is dropped; rows with no content are skipped. Fields are trimmed.
 */
export const parseCsvRecords = (text: string): string[][] => {
  let csvText = text;
  if (csvText.charCodeAt(0) === 0xfeff) csvText = csvText.slice(1);

  const records: string[][] = [];
  let inQuote = false;
  let currentField = '';
  let currentRow: string[] = [];

  const endRow = () => {
    currentRow.push(currentField.trim());
    if (currentRow.some(field => field.length > 0)) records.push(currentRow);
    currentRow = [];
    currentField = '';
  };

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuote && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (char === ',' && !inQuote) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\n' || char === '\r') && !inQuote) {
      endRow();
      if (char === '\r' && nextChar === '\n') i++;
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) endRow();
  return records;
};
