type WorkbookLike = {
  vbaraw?: unknown;
  SheetNames?: string[];
  Sheets?: Record<string, any>;
};

const BLOCKED_MACRO_EXTENSIONS = new Set(['xlsm', 'xlam', 'xlsb', 'xltm', 'xla']);
const MACRO_SIGNATURES = ['vbaproject.bin', '_vba_project', 'macrosheets', 'xl/vba'];
const SCAN_WINDOW_BYTES = 2 * 1024 * 1024;

const macroBlockedMessage =
  'Security policy: macro-enabled Excel files are not allowed. Please remove macros and upload a clean workbook.';

export function getFileExtension(fileName: string): string {
  const normalized = String(fileName || '').trim().toLowerCase();
  const parts = normalized.split('.');
  return parts.length > 1 ? parts.pop() || '' : '';
}

function decodeBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('latin1').decode(bytes);
  } catch {
    let result = '';
    for (let i = 0; i < bytes.length; i += 1) {
      result += String.fromCharCode(bytes[i]);
    }
    return result;
  }
}

export function detectMacroSignatureInBuffer(buffer: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) return null;

  const head = bytes.subarray(0, Math.min(bytes.length, SCAN_WINDOW_BYTES));
  const tail =
    bytes.length > SCAN_WINDOW_BYTES
      ? bytes.subarray(bytes.length - SCAN_WINDOW_BYTES)
      : new Uint8Array(0);

  const scanText = `${decodeBytes(head)}\n${decodeBytes(tail)}`.toLowerCase();
  for (const signature of MACRO_SIGNATURES) {
    if (scanText.includes(signature)) return signature;
  }

  return null;
}

export function assertExcelBufferIsSafe(fileName: string, buffer: ArrayBuffer): void {
  const extension = getFileExtension(fileName);
  if (BLOCKED_MACRO_EXTENSIONS.has(extension)) {
    throw new Error(`${macroBlockedMessage} Blocked extension: .${extension}`);
  }

  const signature = detectMacroSignatureInBuffer(buffer);
  if (signature) {
    throw new Error(`${macroBlockedMessage} Detected macro signature: ${signature}`);
  }
}

export function assertWorkbookHasNoMacros(fileName: string, workbook: WorkbookLike | null | undefined): void {
  if (!workbook) return;
  if (workbook.vbaraw) {
    throw new Error(`${macroBlockedMessage} Detected embedded VBA project in "${fileName}".`);
  }

  const sheets = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
  const macroSheets = sheets.filter((sheetName) => {
    const worksheet = workbook.Sheets?.[sheetName];
    const sheetType = String(worksheet?.['!type'] ?? '').toLowerCase();
    return sheetType.includes('macro');
  });

  if (macroSheets.length > 0) {
    throw new Error(
      `${macroBlockedMessage} Detected macro sheet(s): ${macroSheets.join(', ')}.`
    );
  }
}
