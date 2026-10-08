import type { Rng } from "../questions/rng";
import { contentHash, type VerifiedQuestion } from "../questions/generate";
import { fmtInt } from "../questions/kit";
import { generatedQuestionSchema } from "../questions/types";
import { verifyQuestion } from "../questions/verify";

/**
 * Paper 1 is multiple choice, but most of what ZimTutor can ask is typed. A question whose answer is a
 * whole number can be offered as a choice instead: the right answer, and wrong ones made from the slips
 * the question already predicts (with the misconception each shows) topped up with near misses.
 *
 * It is done only where it is safe. Fractions, decimals and answers with units are left alone (their
 * wrong answers cannot be written reliably from here), and so is any question whose wording tells the
 * child to type or write something. The result goes through the same checks as every other question
 * (schema, self-consistency, hints that give nothing away) and is dropped if it fails any.
 */

const LABELS = ["A", "B", "C", "D"] as const;
const WHOLE = /^\d{1,12}$/;
const TYPING = /\b(?:type|write|enter|fill in|give your answer|show your working|round)\b/i;

export function toMultipleChoice(question: VerifiedQuestion, rng: Rng): VerifiedQuestion | null {
  if (question.marking.method !== "EXACT_NUMERIC") return null;
  if (question.type === "TRUE_FALSE") return null;
  if (TYPING.test(question.stem)) return null;
  const correct = question.marking.value;
  if (!WHOLE.test(correct)) return null;
  const answer = Number(correct);

  // wrong answers, best first: the predicted slips (each with its misconception), then near misses
  const wrong = new Map<number, string | undefined>();
  for (const [value, tag] of Object.entries(question.distractorMap)) {
    if (WHOLE.test(value) && Number(value) !== answer) wrong.set(Number(value), tag);
  }
  const tagged = rng.shuffle([...wrong.keys()]);
  // near misses in three tiers, the likeliest slips first, each in a size that suits the answer:
  // "102" is no plausible wrong answer to "2"
  const tiers: number[][] = [
    [answer + 1, answer - 1, answer + 2, answer - 2, answer + 3, answer - 3],
    [answer + 5, answer - 5, ...(answer >= 20 ? [answer + 10, answer - 10] : [])],
    [
      ...(answer >= 200 ? [answer + 100, answer - 100] : []),
      ...(answer >= 10 ? [answer * 10, swapLastTwoDigits(answer)] : []),
      ...(answer >= 10 && answer % 10 === 0 ? [answer / 10] : []),
    ],
  ];
  const nearMisses: number[] = [];
  for (const tier of tiers) {
    const fresh = tier.filter(
      (n) =>
        n >= 0 &&
        n !== answer &&
        Number.isSafeInteger(n) &&
        !wrong.has(n) &&
        !nearMisses.includes(n) &&
        String(n).length <= String(answer).length + 1,
    );
    nearMisses.push(...rng.shuffle([...new Set(fresh)]));
  }
  const chosen = [...tagged, ...nearMisses].slice(0, 3);
  if (chosen.length < 3) return null;

  const entries = rng.shuffle([
    { value: answer, right: true, tag: undefined as string | undefined },
    ...chosen.map((value) => ({ value, right: false, tag: wrong.get(value) })),
  ]);
  const options = entries.map((e, i) => ({ id: LABELS[i]!, text: fmtInt(e.value) }));
  const correctId = options[entries.findIndex((e) => e.right)]!.id;
  const distractorMap: Record<string, string> = {};
  entries.forEach((e, i) => {
    if (!e.right && e.tag) distractorMap[LABELS[i]!] = e.tag;
  });

  // "Type the number" has no place on a multiple-choice question
  const rest: Partial<VerifiedQuestion> = { ...question };
  delete rest.answerHint;
  const converted = {
    ...(rest as VerifiedQuestion),
    templateId: `${question.templateId}.choice`,
    type: "MULTIPLE_CHOICE" as const,
    options,
    marking: { method: "MULTIPLE_CHOICE" as const, correct: [correctId] },
    correctAnswer: correctId,
    distractorMap,
    misconceptionTags: [...new Set(Object.values(distractorMap))],
  };
  const parsed = generatedQuestionSchema.safeParse(converted);
  if (!parsed.success) return null;
  const candidate = { ...converted, contentHash: "", seed: question.seed } as VerifiedQuestion;
  if (verifyQuestion(parsed.data).length > 0) return null;
  return {
    ...candidate,
    contentHash: contentHash({
      objectiveId: converted.objectiveId,
      stem: converted.stem,
      stemData: converted.stemData,
      options,
      marking: converted.marking,
    }),
  };
}

function swapLastTwoDigits(n: number): number {
  const digits = String(n).split("");
  if (digits.length < 2) return -1;
  const a = digits.length - 1;
  [digits[a - 1], digits[a]] = [digits[a]!, digits[a - 1]!];
  const swapped = Number(digits.join(""));
  return String(swapped).length === digits.length ? swapped : -1;
}
