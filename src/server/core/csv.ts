export interface CsvPreview {
  headers: string[];
  rows: string[][];
  totalRowsEstimate: number;
  truncated: boolean;
}

/** Parse the first rows of a CSV/TSV file for preview only. */
export function parseCsvPreview(
  text: string,
  delimiter = ',',
  maxRows = 50,
  maxCols = 20,
): CsvPreview {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    if (record.length > 1 || record[0] !== '') {
      records.push(record.slice(0, maxCols));
    }
    record = [];
  };

  while (i < text.length && records.length <= maxRows) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === delimiter) {
      pushField();
      i++;
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      pushRecord();
      i++;
      continue;
    }
    field += char;
    i++;
  }
  if (field.length || record.length) pushRecord();

  const [headers = [], ...rows] = records;
  return {
    headers,
    rows: rows.slice(0, maxRows),
    totalRowsEstimate: Math.max(rows.length, text.split(/\r?\n/).length - 1),
    truncated: text.length > i,
  };
}
