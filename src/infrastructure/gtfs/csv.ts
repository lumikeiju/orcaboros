export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

/**
 * RFC 4180 parser that can be fed arbitrary text chunks. It deliberately
 * emits bounded row batches rather than requiring the full entry in memory.
 */
export class CsvStreamParser {
  private field = "";
  private row: string[] = [];
  private inQuotes = false;
  private quotePending = false;
  private pendingCarriageReturn = false;
  private receivedInput = false;
  private atStart = true;

  push(chunk: string, final = false): readonly string[][] {
    const rows: string[][] = [];
    for (let index = 0; index < chunk.length; index += 1) {
      let character = chunk[index];
      if (this.pendingCarriageReturn) {
        this.pendingCarriageReturn = false;
        if (character === "\n") {
          continue;
        }
      }
      this.receivedInput = true;
      if (this.atStart && character === "\ufeff") {
        this.atStart = false;
        continue;
      }
      this.atStart = false;

      if (this.inQuotes) {
        if (this.quotePending) {
          if (character === '"') {
            this.field += '"';
            this.quotePending = false;
            continue;
          }
          this.inQuotes = false;
          this.quotePending = false;
          if (character !== "," && character !== "\r" && character !== "\n") {
            throw new CsvParseError(
              "Unexpected characters after a closing quote"
            );
          }
        } else if (character === '"') {
          this.quotePending = true;
          continue;
        } else {
          this.field += character;
          continue;
        }
      }

      if (character === '"' && this.field.length === 0) {
        this.inQuotes = true;
        continue;
      }
      if (character === ",") {
        this.row.push(this.field);
        this.field = "";
        continue;
      }
      if (character === "\r" || character === "\n") {
        this.row.push(this.field);
        this.field = "";
        if (this.row.some((value) => value.length > 0)) {
          rows.push(this.row);
        }
        this.row = [];
        if (character === "\r") {
          this.pendingCarriageReturn = true;
        }
        continue;
      }
      this.field += character;
    }

    if (final) {
      if (this.inQuotes && !this.quotePending) {
        throw new CsvParseError("CSV ended inside a quoted field");
      }
      this.inQuotes = false;
      this.quotePending = false;
      if (
        this.receivedInput &&
        (this.field.length > 0 || this.row.length > 0)
      ) {
        this.row.push(this.field);
        rows.push(this.row);
        this.field = "";
        this.row = [];
      }
    }
    return rows;
  }
}

export function parseCsvText(text: string): readonly string[][] {
  return new CsvStreamParser().push(text, true);
}

export function rowToRecord(
  headers: readonly string[],
  values: readonly string[]
): Readonly<Record<string, string>> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = values[index] ?? "";
  });
  return record;
}
