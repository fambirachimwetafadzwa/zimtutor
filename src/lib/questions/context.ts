import type { Rng } from "./rng";

/**
 * Everyday settings for word problems. Local and heritage-based context is used where it fits
 * (a tuck shop, a kombi fare, maize and mangoes, journeys between Zimbabwean towns) — naturally,
 * never forced: templates take a context only when one suits the mathematics, and about half of
 * word problems stay neutral.
 */

export const NAMES = [
  "Tendai",
  "Rudo",
  "Farai",
  "Chipo",
  "Tapiwa",
  "Nyasha",
  "Kudzai",
  "Tatenda",
  "Ruvimbo",
  "Simba",
  "Anesu",
  "Thandiwe",
  "Sipho",
  "Nomsa",
  "Themba",
  "Memory",
  "Tafara",
  "Chenai",
  "Blessing",
  "Lindiwe",
] as const;

/** Countable things, singular/plural, each with an everyday place to meet them. */
export const COUNTABLES = [
  { one: "mango", many: "mangoes", place: "the market" },
  { one: "orange", many: "oranges", place: "the market" },
  { one: "tomato", many: "tomatoes", place: "the garden" },
  { one: "egg", many: "eggs", place: "the farm" },
  { one: "maize cob", many: "maize cobs", place: "the field" },
  { one: "exercise book", many: "exercise books", place: "the school" },
  { one: "pencil", many: "pencils", place: "the school" },
  { one: "goat", many: "goats", place: "the kraal" },
  { one: "bread roll", many: "bread rolls", place: "the tuck shop" },
  { one: "bucket of water", many: "buckets of water", place: "the borehole" },
] as const;

/** Towns with road distances in km (approximate), for rate problems. */
export const ROUTES = [
  { from: "Harare", to: "Bulawayo", km: 440 },
  { from: "Harare", to: "Mutare", km: 260 },
  { from: "Harare", to: "Masvingo", km: 290 },
  { from: "Bulawayo", to: "Victoria Falls", km: 440 },
  { from: "Gweru", to: "Bulawayo", km: 165 },
  { from: "Harare", to: "Kariba", km: 365 },
] as const;

export const SHOP_ITEMS = [
  { name: "exercise book", cents: 50 },
  { name: "pen", cents: 40 },
  { name: "ruler", cents: 60 },
  { name: "loaf of bread", cents: 100 },
  { name: "packet of biscuits", cents: 75 },
  { name: "bottle of water", cents: 80 },
  { name: "school badge", cents: 150 },
] as const;

export interface ContextPick {
  name: string;
  local: boolean;
}

/** A learner-friendly name, and whether the problem is set in a Zimbabwean setting. */
export function pickName(rng: Rng): string {
  return rng.pick(NAMES);
}

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? `${count} ${one}` : `${count} ${many}`;
}
