const STREET_EXPANSIONS: Readonly<Record<string, string>> = {
  aly: "Alley",
  ave: "Avenue",
  blvd: "Boulevard",
  cir: "Circle",
  ct: "Court",
  dr: "Drive",
  hwy: "Highway",
  jct: "Junction",
  ln: "Lane",
  pkwy: "Parkway",
  pl: "Place",
  rd: "Road",
  sq: "Square",
  st: "Street",
  ter: "Terrace",
  tpke: "Turnpike",
  way: "Way"
};

export function expandStreetName(value: string): string {
  return value
    .trim()
    .replace(/\s+/gu, " ")
    .replace(
      /(^|[\s,])([A-Za-z]{2,8})\.?(?=(?:\s|$|,))/gu,
      (match, prefix: string, word: string) => {
        const expanded =
          STREET_EXPANSIONS[word.toLowerCase().replace(/\.$/u, "")];
        return expanded === undefined ? match : `${prefix}${expanded}`;
      }
    );
}

export function normalizeName(value: string): string {
  return expandStreetName(value)
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}
