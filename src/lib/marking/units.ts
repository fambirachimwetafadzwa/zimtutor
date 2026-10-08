import { Rational } from "./rational";

/**
 * Units of the Junior syllabus Measures topic (length, mass, capacity, time, money, area, volume,
 * angle, speed, percent). Each unit knows its dimension and its size in that dimension's base unit,
 * so quantities can be compared exactly and wrong-unit / power-of-ten mistakes can be recognised.
 */

export type Dimension =
  | "LENGTH"
  | "MASS"
  | "CAPACITY"
  | "TIME"
  | "MONEY"
  | "AREA"
  | "VOLUME"
  | "ANGLE"
  | "SPEED"
  | "PERCENT"
  | "TEMPERATURE";

export interface UnitDef {
  /** Canonical symbol, as the syllabus writes it. */
  symbol: string;
  dimension: Dimension;
  /** Size of one of these in the dimension's base unit. */
  toBase: Rational;
  /** Lower-case spellings a learner may type (symbols and words, singular and plural). */
  aliases: string[];
}

const r = (n: number, d = 1) => new Rational(BigInt(n), BigInt(d));

const UNITS: UnitDef[] = [
  {
    symbol: "mm",
    dimension: "LENGTH",
    toBase: r(1, 1000),
    aliases: ["mm", "millimetre", "millimetres", "millimeter", "millimeters"],
  },
  {
    symbol: "cm",
    dimension: "LENGTH",
    toBase: r(1, 100),
    aliases: ["cm", "centimetre", "centimetres", "centimeter", "centimeters"],
  },
  {
    symbol: "m",
    dimension: "LENGTH",
    toBase: r(1),
    aliases: ["m", "metre", "metres", "meter", "meters"],
  },
  {
    symbol: "km",
    dimension: "LENGTH",
    toBase: r(1000),
    aliases: ["km", "kilometre", "kilometres", "kilometer", "kilometers"],
  },

  {
    symbol: "g",
    dimension: "MASS",
    toBase: r(1, 1000),
    aliases: ["g", "gram", "grams", "gramme", "grammes"],
  },
  {
    symbol: "kg",
    dimension: "MASS",
    toBase: r(1),
    aliases: ["kg", "kilogram", "kilograms", "kilogramme", "kilogrammes", "kilo", "kilos"],
  },
  {
    symbol: "t",
    dimension: "MASS",
    toBase: r(1000),
    aliases: ["t", "tonne", "tonnes", "ton", "tons"],
  },

  {
    symbol: "ml",
    dimension: "CAPACITY",
    toBase: r(1, 1000),
    aliases: ["ml", "millilitre", "millilitres", "milliliter", "milliliters"],
  },
  {
    symbol: "ℓ",
    dimension: "CAPACITY",
    toBase: r(1),
    aliases: ["l", "ℓ", "litre", "litres", "liter", "liters"],
  },

  {
    symbol: "s",
    dimension: "TIME",
    toBase: r(1),
    aliases: ["s", "sec", "secs", "second", "seconds"],
  },
  {
    symbol: "min",
    dimension: "TIME",
    toBase: r(60),
    aliases: ["min", "mins", "minute", "minutes"],
  },
  { symbol: "h", dimension: "TIME", toBase: r(3600), aliases: ["h", "hr", "hrs", "hour", "hours"] },
  { symbol: "day", dimension: "TIME", toBase: r(86400), aliases: ["day", "days"] },
  { symbol: "week", dimension: "TIME", toBase: r(604800), aliases: ["week", "weeks"] },
  {
    symbol: "fortnight",
    dimension: "TIME",
    toBase: r(1209600),
    aliases: ["fortnight", "fortnights"],
  },

  // Money: dollars and cents (the unit written "$" or a currency code is the dollar-like unit).
  {
    symbol: "$",
    dimension: "MONEY",
    toBase: r(1),
    aliases: ["$", "usd", "zig", "dollar", "dollars"],
  },
  { symbol: "c", dimension: "MONEY", toBase: r(1, 100), aliases: ["c", "cent", "cents", "¢"] },

  {
    symbol: "cm²",
    dimension: "AREA",
    toBase: r(1, 10000),
    aliases: [
      "cm²",
      "cm2",
      "cm^2",
      "sq cm",
      "square centimetre",
      "square centimetres",
      "square centimeters",
    ],
  },
  {
    symbol: "m²",
    dimension: "AREA",
    toBase: r(1),
    aliases: ["m²", "m2", "m^2", "sq m", "square metre", "square metres", "square meters"],
  },
  // 1 are = 100 m² (the metric unit of land area between the square metre and the hectare)
  { symbol: "are", dimension: "AREA", toBase: r(100), aliases: ["are", "ares"] },
  { symbol: "ha", dimension: "AREA", toBase: r(10000), aliases: ["ha", "hectare", "hectares"] },
  {
    symbol: "km²",
    dimension: "AREA",
    toBase: r(1000000),
    aliases: ["km²", "km2", "km^2", "square kilometre", "square kilometres"],
  },

  {
    symbol: "cm³",
    dimension: "VOLUME",
    toBase: r(1, 1000000),
    aliases: ["cm³", "cm3", "cm^3", "cubic centimetre", "cubic centimetres", "cubic centimeters"],
  },
  {
    symbol: "m³",
    dimension: "VOLUME",
    toBase: r(1),
    aliases: ["m³", "m3", "m^3", "cubic metre", "cubic metres", "cubic meters"],
  },

  {
    symbol: "°",
    dimension: "ANGLE",
    toBase: r(1),
    aliases: ["°", "deg", "degree", "degrees", "º"],
  },

  {
    symbol: "km/h",
    dimension: "SPEED",
    toBase: r(5, 18),
    aliases: ["km/h", "kph", "kmh", "km/hr", "km per hour", "kilometres per hour"],
  },
  {
    symbol: "m/s",
    dimension: "SPEED",
    toBase: r(1),
    aliases: ["m/s", "mps", "metres per second", "meters per second"],
  },

  { symbol: "%", dimension: "PERCENT", toBase: r(1), aliases: ["%", "percent", "per cent"] },
  {
    symbol: "°C",
    dimension: "TEMPERATURE",
    toBase: r(1),
    aliases: ["°c", "ºc", "degrees celsius", "degree celsius", "celsius", "c°"],
  },
];

const BY_ALIAS = new Map<string, UnitDef>();
for (const unit of UNITS) for (const alias of unit.aliases) BY_ALIAS.set(alias, unit);

export function findUnit(text: string): UnitDef | undefined {
  return BY_ALIAS.get(text.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, ""));
}

export function unitBySymbol(symbol: string): UnitDef | undefined {
  return UNITS.find((u) => u.symbol === symbol) ?? findUnit(symbol);
}

export interface Quantity {
  /** Numeric part as written (for a compound like "5 kg 200 g": the total in the FIRST unit). */
  value: Rational;
  unit?: UnitDef;
  /** Total in the base unit of the dimension (when a unit is present). */
  base?: Rational;
  /** More than one value/unit pair was written ("5 kg 200 g"). */
  compound: boolean;
}

/**
 * Unit aliases, longest first, so "cm2" is tried before "cm" and "square centimetres" before "m".
 * Recognised case-insensitively.
 */
const ALIASES_LONGEST_FIRST = [...BY_ALIAS.keys()].sort((a, b) => b.length - a.length);

/** The unit starting at `pos`, if the text there is a known unit followed by a boundary. */
function unitAt(text: string, pos: number): { unit: UnitDef; end: number } | null {
  const rest = text.slice(pos).toLowerCase();
  for (const alias of ALIASES_LONGEST_FIRST) {
    if (!rest.startsWith(alias)) continue;
    const after = rest.slice(alias.length);
    // A unit must end at a boundary: end of text, whitespace, a digit (next quantity) or punctuation.
    if (
      after === "" ||
      /^[\s\d.,;]/.test(after) ||
      (!/[a-z]/.test(alias.slice(-1)) && !/^[a-z]/.test(after))
    ) {
      return { unit: BY_ALIAS.get(alias)!, end: pos + alias.length };
    }
  }
  return null;
}

const NUMBER_TOKENS = [
  /^-?\d+ \d+\/\d+/, // 2 1/2
  /^-?\d+\s*\/\s*\d+/, // 3/4
  /^-?\d{1,3}(?: \d{3})+(?:[.,]\d+)?/, // 12 345,5
  /^-?\d+(?:[.,]\d+)?/, // 12,5
  /^-?[.,]\d+/, // .5
];

function numberAt(text: string, pos: number): { text: string; end: number } | null {
  const rest = text.slice(pos);
  for (const pattern of NUMBER_TOKENS) {
    const m = pattern.exec(rest);
    if (m) return { text: m[0], end: pos + m[0].length };
  }
  return null;
}

/**
 * Split "5,5 cm", "$12.50", "250 cm2", "3 h 20 min" into number(s) and unit(s). `parseNumber` is
 * injected so this module does not depend on how learner numbers are read.
 */
export function parseQuantity(
  raw: string,
  parseNumber: (text: string) => Rational | null,
):
  | { ok: true; quantity: Quantity }
  | { ok: false; reason: "EMPTY" | "NOT_A_QUANTITY" | "MIXED_DIMENSIONS" } {
  const text = raw
    .normalize("NFKC")
    .replace(/[\u00a0\u2009\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return { ok: false, reason: "EMPTY" };

  const pairs: Array<{ value: Rational; unit?: UnitDef }> = [];
  let pos = 0;

  // A leading currency sign: "$12.50", "ZiG 5"
  const lead = unitAt(text, 0);
  let leadUnit: UnitDef | undefined;
  if (
    lead &&
    lead.unit.dimension === "MONEY" &&
    /^[\s\d.,-]/.test(text.slice(lead.end) || " ") &&
    text.slice(lead.end).trim() !== ""
  ) {
    leadUnit = lead.unit;
    pos = lead.end;
  }

  while (pos < text.length) {
    while (text[pos] === " ") pos++;
    if (pos >= text.length) break;
    const num = numberAt(text, pos);
    if (!num) return { ok: false, reason: "NOT_A_QUANTITY" };
    const value = parseNumber(num.text);
    if (!value) return { ok: false, reason: "NOT_A_QUANTITY" };
    pos = num.end;
    while (text[pos] === " ") pos++;
    if (leadUnit && pairs.length === 0) {
      pairs.push({ value, unit: leadUnit });
      continue;
    }
    const unit = pos < text.length ? unitAt(text, pos) : null;
    if (unit) {
      pairs.push({ value, unit: unit.unit });
      pos = unit.end;
    } else if (pos >= text.length) {
      pairs.push({ value });
    } else {
      return { ok: false, reason: "NOT_A_QUANTITY" }; // trailing text that is not a unit
    }
  }
  if (pairs.length === 0) return { ok: false, reason: "NOT_A_QUANTITY" };

  if (pairs.length === 1) {
    const only = pairs[0]!;
    return only.unit
      ? {
          ok: true,
          quantity: {
            value: only.value,
            unit: only.unit,
            base: only.value.mul(only.unit.toBase),
            compound: false,
          },
        }
      : { ok: true, quantity: { value: only.value, compound: false } };
  }

  // Compound ("5 kg 200 g"): every pair needs a unit, all of one dimension.
  let total = Rational.ZERO;
  let first: UnitDef | undefined;
  for (const p of pairs) {
    if (!p.unit) return { ok: false, reason: "NOT_A_QUANTITY" };
    first ??= p.unit;
    if (p.unit.dimension !== first.dimension) return { ok: false, reason: "MIXED_DIMENSIONS" };
    total = total.add(p.value.mul(p.unit.toBase));
  }
  return {
    ok: true,
    quantity: { value: total.div(first!.toBase), unit: first, base: total, compound: true },
  };
}
