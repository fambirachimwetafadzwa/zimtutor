/**
 * Exact rational arithmetic on BigInt.
 *
 * Marking must never depend on floating point: 0.1 + 0.2 is not 0.3 in IEEE doubles, and a child
 * who writes 0.3 must be marked right. Every number the marker sees becomes a Rational, and every
 * comparison is exact.
 */

const abs = (n: bigint) => (n < 0n ? -n : n);

function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

export class Rational {
  readonly num: bigint;
  readonly den: bigint;

  constructor(num: bigint, den: bigint = 1n) {
    if (den === 0n) throw new RangeError("Division by zero");
    const sign = den < 0n ? -1n : 1n;
    const g = gcd(num, den) || 1n;
    this.num = (sign * num) / g;
    this.den = (sign * den) / g;
  }

  static readonly ZERO = new Rational(0n);
  static readonly ONE = new Rational(1n);

  static of(n: number | bigint): Rational {
    if (typeof n === "bigint") return new Rational(n);
    if (!Number.isInteger(n))
      throw new TypeError("Rational.of needs an integer; parse decimals with parseDecimal");
    return new Rational(BigInt(n));
  }

  /** "12", "-3.75", "0.005" → exact value. Returns null if the text is not a plain decimal. */
  static parseDecimal(text: string): Rational | null {
    const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
    if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;
    const intPart = m[2] || "0";
    const frac = m[3] ?? "";
    const value = new Rational(BigInt(intPart + frac), 10n ** BigInt(frac.length));
    return m[1] === "-" ? value.neg() : value;
  }

  add(o: Rational): Rational {
    return new Rational(this.num * o.den + o.num * this.den, this.den * o.den);
  }
  sub(o: Rational): Rational {
    return new Rational(this.num * o.den - o.num * this.den, this.den * o.den);
  }
  mul(o: Rational): Rational {
    return new Rational(this.num * o.num, this.den * o.den);
  }
  div(o: Rational): Rational {
    if (o.num === 0n) throw new RangeError("Division by zero");
    return new Rational(this.num * o.den, this.den * o.num);
  }
  neg(): Rational {
    return new Rational(-this.num, this.den);
  }
  pow(exponent: number): Rational {
    if (!Number.isInteger(exponent) || Math.abs(exponent) > 64)
      throw new RangeError("Exponent out of range");
    let result = Rational.ONE;
    for (let i = 0; i < Math.abs(exponent); i++) result = result.mul(this);
    return exponent < 0 ? Rational.ONE.div(result) : result;
  }

  equals(o: Rational): boolean {
    return this.num === o.num && this.den === o.den;
  }
  /** -1, 0 or 1. */
  compare(o: Rational): number {
    const left = this.num * o.den;
    const right = o.num * this.den;
    return left < right ? -1 : left > right ? 1 : 0;
  }
  isZero(): boolean {
    return this.num === 0n;
  }
  isInteger(): boolean {
    return this.den === 1n;
  }
  isNegative(): boolean {
    return this.num < 0n;
  }
  absValue(): Rational {
    return new Rational(abs(this.num), this.den);
  }

  /**
   * Decimal text if the value has a finite decimal expansion (denominator of only 2s and 5s), at
   * most `maxPlaces` places; otherwise null.
   */
  toDecimalString(maxPlaces = 12): string | null {
    let d = this.den;
    let twos = 0;
    let fives = 0;
    while (d % 2n === 0n) {
      d /= 2n;
      twos++;
    }
    while (d % 5n === 0n) {
      d /= 5n;
      fives++;
    }
    if (d !== 1n) return null;
    const places = Math.max(twos, fives);
    if (places > maxPlaces) return null;
    const scaled = (abs(this.num) * 10n ** BigInt(places)) / this.den;
    let digits = scaled.toString().padStart(places + 1, "0");
    if (places > 0) digits = `${digits.slice(0, -places)}.${digits.slice(-places)}`;
    return `${this.num < 0n ? "-" : ""}${digits}`;
  }

  /** "3/4", or "5" for integers. */
  toFractionString(): string {
    return this.den === 1n ? this.num.toString() : `${this.num}/${this.den}`;
  }

  toString(): string {
    return this.toDecimalString() ?? this.toFractionString();
  }

  /** For display and diagnostics only — never for comparison. */
  toNumber(): number {
    return Number(this.num) / Number(this.den);
  }
}

export function lowestTerms(n: bigint, d: bigint): boolean {
  return d !== 0n && gcd(n, d) === 1n;
}

export { gcd };
