const STREET_SUFFIX_EXPANSIONS: Readonly<Record<string, string>> = {
  Acc: "Access",
  Aly: "Alley",
  Ambl: "Amble",
  App: "Approach",
  Arc: "Arcade",
  Artl: "Arterial",
  Arty: "Artery",
  Av: "Avenue",
  Ave: "Avenue",
  Bch: "Beach",
  Bg: "Burg",
  Bgs: "Burgs",
  Blf: "Bluff",
  Blk: "Block",
  Blv: "Boulevard",
  Blvd: "Boulevard",
  Bnd: "Bend",
  Br: "Bridge",
  Brg: "Bridge",
  Btm: "Bottom",
  Bwlk: "Boardwalk",
  Byp: "Bypass",
  Bypa: "Bypass",
  Byu: "Byou",
  Bywy: "Byway",
  Bzr: "Bazaar",
  Cct: "Circuit",
  Ch: "Chase",
  Cir: "Circle",
  Cirs: "Circles",
  Clf: "Cliff",
  Clfs: "Cliffs",
  Cly: "Colony",
  Cmn: "Common",
  Cnl: "Canal",
  Cnr: "Corner",
  Coll: "College",
  Cpe: "Cape",
  Cr: "Creek",
  Crk: "Creek",
  Cres: "Crescent",
  Crst: "Crest",
  Cswy: "Causeway",
  Ct: "Court",
  Ctr: "Center",
  Cts: "Courts",
  Ctyd: "Courtyard",
  Curv: "Curve",
  Cutt: "Cutting",
  Cv: "Cove",
  Cyn: "Canyon",
  Dl: "Dale",
  Dr: "Drive",
  Dv: "Drive",
  Dvwy: "Driveway",
  Elb: "Elbow",
  Est: "Estate",
  Ests: "Estates",
  Expy: "Expressway",
  Expwy: "Expressway",
  Fawy: "Fairway",
  Fld: "Field",
  Flds: "Fields",
  Fmrd: "Farm to Market Road",
  Ftrl: "Firetrail",
  Frk: "Fork",
  Fry: "Ferry",
  Fwy: "Freeway",
  Gd: "Grade",
  Gdns: "Gardens",
  Gr: "Grove",
  Gro: "Grove",
  Grv: "Grove",
  Hbr: "Harbor",
  Hl: "Hill",
  Hls: "Hills",
  Holw: "Hollow",
  Hts: "Heights",
  Hw: "Highway",
  Hwy: "Highway",
  Hvn: "Haven",
  Intg: "Interchange",
  Iss: "Islands",
  Jct: "Junction",
  Jn: "Junction",
  Jnc: "Junction",
  Knl: "Knoll",
  Knls: "Knolls",
  Ky: "Key",
  Kys: "Keys",
  Lck: "Lock",
  Lcks: "Locks",
  Ldg: "Lodge",
  Lk: "Lake",
  Lks: "Lakes",
  Lkt: "Lookout",
  Ln: "Lane",
  Lndg: "Landing",
  Lp: "Loop",
  Mal: "Mall",
  Mdw: "Meadow",
  Mdws: "Meadows",
  Mkt: "Market",
  Ml: "Mill",
  Mt: "Mount",
  Mtn: "Mountain",
  Mtwy: "Motorway",
  Orch: "Orchard",
  Ovps: "Overpass",
  Piaz: "Piazza",
  Pk: "Peak",
  Pky: "Parkway",
  Pkwy: "Parkway",
  Pl: "Place",
  Pln: "Plain",
  Plns: "Plains",
  Plz: "Plaza",
  Pnt: "Point",
  Prkwy: "Parkway",
  Pt: "Point",
  Pvt: "Private",
  Qdrt: "Quadrant",
  Qtrs: "Quarters",
  Qy: "Quay",
  Qys: "Quays",
  Rd: "Road",
  Rds: "Roads",
  Rdg: "Ridge",
  Rdge: "Ridge",
  Rdgs: "Ridges",
  Rw: "Row",
  Rmrd: "Ranch to Market Road",
  Rt: "Route",
  Rte: "Route",
  Rty: "Rotary",
  Shl: "Shoal",
  Shls: "Shoals",
  Shr: "Shore",
  Shrs: "Shores",
  Skwy: "Skyway",
  Smt: "Summit",
  Spg: "Spring",
  Spgs: "Springs",
  Sq: "Square",
  Sqs: "Squares",
  Srvc: "Service",
  St: "Street",
  Tce: "Terrace",
  Ter: "Terrace",
  Tfwy: "Trafficway",
  Thfr: "Thoroughfare",
  Thwy: "Throughway",
  Tl: "Trail",
  Tlwy: "Tollway",
  Tpke: "Turnpike",
  Trce: "Trace",
  Tr: "Trail",
  Trk: "Track",
  Trl: "Trail",
  Tunl: "Tunnel",
  Unp: "Underpass",
  Vl: "Villa",
  Vlg: "Village",
  Vlgs: "Villages",
  Vly: "Valley",
  Vw: "View",
  Wd: "Wood",
  Whrf: "Wharf",
  Wkwy: "Walkway",
  Wlk: "Walk",
  Wy: "Way",
  Xing: "Crossing"
};

const STREET_SUFFIX_EXPANSIONS_LOWERCASE: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(STREET_SUFFIX_EXPANSIONS).map(([key, value]) => [
      key.toLowerCase(),
      value
    ])
  );

const DIRECTIONAL_EXPANSIONS: Readonly<Record<string, string>> = {
  N: "North",
  S: "South",
  E: "East",
  W: "West",
  NE: "Northeast",
  SE: "Southeast",
  SW: "Southwest",
  NW: "Northwest"
};

const DIRECTION_BOUND_EXPANSIONS: Readonly<Record<string, string>> = {
  NB: "Northbound",
  SB: "Southbound",
  EB: "Eastbound",
  WB: "Westbound"
};

function normalizeStreetWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function isAllCaps(value: string): boolean {
  const letters = [...value].filter((character) =>
    /\p{Letter}/u.test(character)
  );
  return (
    letters.length > 0 &&
    letters.some((character) => /\p{Uppercase_Letter}/u.test(character)) &&
    letters.every((character) => !/\p{Lowercase_Letter}/u.test(character))
  );
}

function toFirstCaps(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(
      /(^|[^\p{Letter}\p{Number}])(\p{Letter})/gu,
      (match: string, prefix: string, letter: string) =>
        `${prefix}${letter.toLocaleUpperCase("en-US")}`
    );
}

function expandUncommonNames(value: string, allCaps: boolean): string {
  const flags = allCaps ? "iu" : "u";
  const countyRoadPattern = new RegExp("^CR(?=\\s+\\d{0,4}$)", flags);
  const forestServiceRoadPattern = new RegExp(
    "^US Highway Fs Road(?=\\s+\\d{0,4}$)",
    flags
  );
  return value
    .replace(countyRoadPattern, "County Road")
    .replace(forestServiceRoadPattern, "US Highway Forest Service Road");
}

function expandPrefixDirection(value: string): string {
  const withExpandedDirections = value.replace(
    /(^|&\s*)(NE|SE|SW|NW|N|S|E|W)(\.?)(\s+)/giu,
    (
      match: string,
      prefix: string,
      abbreviation: string,
      _period: string,
      whitespace: string,
      offset: number,
      wholeValue: string
    ) => {
      const remainder = wholeValue.slice(offset + match.length);
      if (/^(?:[A-Za-z]\.(?:\s|$)|St\.?\s|Street\b)/iu.test(remainder)) {
        return match;
      }
      const direction = DIRECTIONAL_EXPANSIONS[abbreviation.toUpperCase()];
      return direction === undefined
        ? match
        : `${prefix}${direction}${whitespace}`;
    }
  );

  return withExpandedDirections.replace(/(^|&\s*)So\.(\s+)/giu, "$1South$2");
}

function expandDirectionBound(value: string): string {
  return value.replace(
    /\s+(NB|SB|EB|WB)\.?$/iu,
    (match: string, abbreviation: string) =>
      ` ${DIRECTION_BOUND_EXPANSIONS[abbreviation.toUpperCase()] ?? abbreviation}`
  );
}

function expandPostfixDirection(value: string): string {
  if (/^(?:Avenue|Ave\.?) [NSEW]$/iu.test(value)) {
    return value;
  }
  const boundSuffix = value.match(
    /\s+-\s+(?:Northbound|Southbound|Eastbound|Westbound)\s*$/iu
  );
  if (boundSuffix !== null && boundSuffix.index !== undefined) {
    const streetPart = value.slice(0, boundSuffix.index);
    const suffix = value.slice(boundSuffix.index);
    return `${streetPart.replace(
      /\s+(NE|SE|SW|NW|N|S|E|W)\.?(?=\s*(?:&|$))/giu,
      (match: string, abbreviation: string) =>
        ` ${DIRECTIONAL_EXPANSIONS[abbreviation.toUpperCase()] ?? abbreviation}`
    )}${suffix}`;
  }
  return value.replace(
    /\s+(NE|SE|SW|NW|N|S|E|W)\.?$/iu,
    (match: string, abbreviation: string) =>
      ` ${DIRECTIONAL_EXPANSIONS[abbreviation.toUpperCase()] ?? abbreviation}`
  );
}

function expandCommonAbbreviations(value: string): string {
  return value.replace(
    /(^|[\s,])([A-Za-z]{2,8})\.?(?=(?:\s|$|,))/gu,
    (match: string, prefix: string, word: string) => {
      const expanded = STREET_SUFFIX_EXPANSIONS_LOWERCASE[word.toLowerCase()];
      return expanded === undefined ? match : `${prefix}${expanded}`;
    }
  );
}

/**
 * Cleans US street names using the rules in local-storage/streetname.
 * The suffix table is derived from USStreetNameExpander.validator.mapcss;
 * directional and uncommon-name handling follows the companion rules.
 */
export function cleanupStreetName(value: string): string {
  const normalized = normalizeStreetWhitespace(value);
  if (normalized.length === 0) {
    return normalized;
  }

  const allCaps = isAllCaps(normalized);
  let cleaned = allCaps ? toFirstCaps(normalized) : normalized;
  cleaned = expandUncommonNames(cleaned, allCaps);
  cleaned = expandPrefixDirection(cleaned);
  cleaned = expandDirectionBound(cleaned);
  cleaned = expandPostfixDirection(cleaned);
  return normalizeStreetWhitespace(expandCommonAbbreviations(cleaned));
}

export function expandStreetName(value: string): string {
  return cleanupStreetName(value);
}

export function normalizeName(value: string): string {
  return cleanupStreetName(value)
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}
