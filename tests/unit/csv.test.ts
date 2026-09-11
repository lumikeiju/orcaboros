import { describe, expect, it } from "vitest";
import {
  CsvStreamParser,
  parseCsvText
} from "../../src/infrastructure/gtfs/csv";

describe("streaming CSV parser", () => {
  it("handles quoted delimiters, escaped quotes, and newlines across chunks", () => {
    const parser = new CsvStreamParser();
    const rows = [
      ...parser.push(
        'stop_id,stop_name,stop_lat,stop_lon\r\n1,"Main, ""',
        false
      ),
      ...parser.push('St\nNorth""",47.1,-122.1\r', false),
      ...parser.push("\n", true)
    ];
    expect(rows).toEqual([
      ["stop_id", "stop_name", "stop_lat", "stop_lon"],
      ["1", 'Main, "St\nNorth"', "47.1", "-122.1"]
    ]);
  });

  it("rejects an unterminated quoted field", () => {
    expect(() => parseCsvText('a,b\n"unterminated')).toThrow(
      "inside a quoted field"
    );
  });
});
