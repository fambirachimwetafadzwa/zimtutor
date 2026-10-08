import type { QuestionTemplate } from "../types";
import { dataTemplates } from "./data";
import { decimalTemplates } from "./decimals";
import { directionTemplates } from "./direction";
import { fractionTemplates } from "./fractions";
import { geometryTemplates } from "./geometry";
import { measurementTemplates } from "./measurement";
import { moneyTemplates } from "./money";
import { rateTemplates } from "./rate";
import { timeTemplates } from "./time";
import { trueFalseTemplates } from "./true-false";
import { rationalOperationTemplates } from "./rational-operations";
import { wholeNumberTemplates } from "./whole-numbers";
import { wholeOperationTemplates } from "./whole-operations";

/**
 * Every question template, in a stable order. A template is added here only together with tests
 * (tests/questions) that generate it across every objective it covers, difficulty and many seeds.
 */
export const ALL_TEMPLATES: readonly QuestionTemplate[] = [
  ...wholeNumberTemplates,
  ...fractionTemplates,
  ...decimalTemplates,
  ...wholeOperationTemplates,
  ...rationalOperationTemplates,
  ...moneyTemplates,
  ...timeTemplates,
  ...measurementTemplates,
  ...geometryTemplates,
  ...directionTemplates,
  ...rateTemplates,
  ...dataTemplates,
  ...trueFalseTemplates,
];

const byId = new Map(ALL_TEMPLATES.map((t) => [t.id, t]));
if (byId.size !== ALL_TEMPLATES.length) throw new Error("Duplicate question template id");

export function getTemplate(id: string): QuestionTemplate | undefined {
  return byId.get(id);
}
