import type { QuestionTemplate } from "../types";
import { decimalTemplates } from "./decimals";
import { fractionTemplates } from "./fractions";
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
];

const byId = new Map(ALL_TEMPLATES.map((t) => [t.id, t]));
if (byId.size !== ALL_TEMPLATES.length) throw new Error("Duplicate question template id");

export function getTemplate(id: string): QuestionTemplate | undefined {
  return byId.get(id);
}
