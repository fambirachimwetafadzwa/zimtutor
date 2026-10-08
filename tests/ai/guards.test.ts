import { describe, expect, it } from "vitest";
import {
  checkTutorText,
  contradictsVerdict,
  leakedAnswer,
  numbersIn,
  plainText,
  secretFromKey,
  unsupportedNumbers,
  wordCount,
  type GuardFailure,
  type SecretAnswer,
} from "../../src/lib/ai/guards";
import {
  detectContactAttempts,
  detectHumanClaims,
  detectManipulation,
  detectOverclaims,
  detectPersonalDetails,
  detectPersonalQuestions,
} from "../../src/lib/ai/patterns";
import { generateQuestion } from "../../src/lib/questions/generate";
import { ALL_TEMPLATES } from "../../src/lib/questions/templates";
import { OBJECTIVES } from "../questions/support";

const numeric = (value: string) => ({ method: "EXACT_NUMERIC" as const, value });

describe("the secret answer of a question", () => {
  it("includes the answer in digits and in words", () => {
    const secret = secretFromKey({ spec: numeric("42"), display: "42" });
    expect(secret.forms).toContain("42");
    expect(secret.forms).toContain("forty-two");
    expect(leakedAnswer("So the total is 42 mangoes.", secret)).toBe("42");
    expect(leakedAnswer("That makes forty-two altogether", secret)).toBe("forty-two");
    expect(leakedAnswer("Forty two is the number", secret)).toBe("forty two");
    expect(leakedAnswer("Think of 40 and 2", secret)).toBeNull();
    expect(leakedAnswer("Try 142 and 4.2", secret)).toBeNull();
  });

  it("knows a number printed with a space between the thousands", () => {
    const secret = secretFromKey({ spec: numeric("4305"), display: "4305" });
    expect(leakedAnswer("It comes to 4 305 in all", secret)).not.toBeNull();
    expect(leakedAnswer("It comes to 4305 in all", secret)).not.toBeNull();
    expect(leakedAnswer("four thousand three hundred and five", secret)).not.toBeNull();
  });

  it("only catches a one-digit answer where it is given as the answer", () => {
    const secret = secretFromKey({ spec: numeric("7"), display: "7" });
    expect(secret.short).toEqual(expect.arrayContaining(["7", "seven"]));
    expect(leakedAnswer("The answer is 7.", secret)).toBe("7");
    expect(leakedAnswer("3 + 4 = 7", secret)).toBe("7");
    expect(leakedAnswer("That makes seven.", secret)).toBe("seven");
    expect(leakedAnswer("So you get 7 left", secret)).toBe("7");
    // ordinary uses of the same digit are fine
    expect(leakedAnswer("Count 7 steps along the number line", secret)).toBeNull();
    expect(leakedAnswer("Step 7 is to check your work", secret)).toBeNull();
    expect(leakedAnswer("Try 7 + 2 first", secret)).toBeNull();
    expect(leakedAnswer("You have 7 minutes", secret)).toBeNull();
    expect(leakedAnswer("Look at the 7 in the tens column", secret)).toBeNull();
  });

  it("keeps ordinary small words quiet unless they are given as the answer", () => {
    const secret = secretFromKey({ spec: numeric("2"), display: "2" });
    expect(leakedAnswer("Take one step, then two more", secret)).toBeNull();
    expect(leakedAnswer("The answer is two.", secret)).toBe("two");
  });

  it("covers option letters and the option text of multiple choice", () => {
    const options = [
      { id: "A", text: "12" },
      { id: "B", text: "15" },
      { id: "C", text: "150" },
    ];
    const secret = secretFromKey(
      { spec: { method: "MULTIPLE_CHOICE", correct: ["B"] }, display: "B" },
      options,
    );
    expect(secret.forms).toContain("15");
    expect(secret.short).toContain("B");
    expect(leakedAnswer("The answer is B.", secret)).toBe("B");
    expect(leakedAnswer("Choose option B", secret)).toBe("B");
    expect(leakedAnswer("Option B is right", secret)).toBe("B");
    expect(leakedAnswer("It is 15", secret)).toBe("15");
    expect(leakedAnswer("Choose A if you like", secret)).toBeNull();
    expect(leakedAnswer("Compare 12 and 150", secret)).toBeNull();
  });

  it("covers true or false, but not the question being asked", () => {
    const secret = secretFromKey({ spec: { method: "TRUE_FALSE", value: false }, display: false });
    expect(secret.truthValue).toBe(false);
    expect(leakedAnswer("That statement is false.", secret)).not.toBeNull();
    expect(leakedAnswer("It is true.", secret)).not.toBeNull();
    expect(leakedAnswer("The answer is false", secret)).not.toBeNull();
    expect(leakedAnswer("Choose true", secret)).not.toBeNull();
    expect(leakedAnswer("Decide whether the statement is true or false.", secret)).toBeNull();
    expect(leakedAnswer("Check each part before you say true or false", secret)).toBeNull();
    expect(leakedAnswer("Is it true? Work it out.", secret)).toBeNull();
  });

  it("covers every part of a multi-part answer and fractions", () => {
    const multi = secretFromKey({
      spec: {
        method: "MULTI_PART",
        parts: [
          { id: "a", marks: 1, spec: numeric("12") },
          { id: "b", marks: 1, spec: numeric("0.5") },
        ],
      },
      display: { a: "12", b: "0.5" },
    });
    expect(leakedAnswer("Part a is 12", multi)).toBe("12");
    expect(leakedAnswer("and b is 0.5", multi)).toBe("0.5");
    const fraction = secretFromKey({
      spec: { method: "FRACTION_LOWEST_TERMS", value: "3/4" },
      display: "3/4",
    });
    expect(leakedAnswer("You should get 3/4", fraction)).toBe("3/4");
    expect(leakedAnswer("Think of 3/40", fraction)).toBeNull();
  });
});

describe("answers made of several items", () => {
  const ordering = secretFromKey({
    spec: { method: "ORDERED_SEQUENCE", sequence: ["6 144", "6 244", "6 403", "6 599"] },
    display: ["6 144", "6 244", "6 403", "6 599"],
  });

  it("catches the whole order stated, however the numbers are written", () => {
    expect(leakedAnswer("The order is 6 144, 6 244, 6 403 and 6 599.", ordering)).not.toBeNull();
    expect(leakedAnswer("6144 < 6244 < 6403 < 6599", ordering)).not.toBeNull();
    expect(
      leakedAnswer("smallest first: 6,144 then 6,244 then 6,403 then 6,599", ordering),
    ).not.toBeNull();
  });

  it("lets a hint talk about some of the items, or list them in another order", () => {
    expect(leakedAnswer("Compare 6 144 and 6 244 first.", ordering)).toBeNull();
    expect(leakedAnswer("Look at 6 599, 6 244, 6 403 and 6 144.", ordering)).toBeNull();
    expect(leakedAnswer("Which has the fewest thousands?", ordering)).toBeNull();
  });

  const pairs = secretFromKey({
    spec: { method: "MATCHING_PAIRS", pairs: { IV: "4", VI: "6", IX: "9" } },
    display: { IV: "4", VI: "6", IX: "9" },
  });

  it("catches a pair said to go together, in either direction", () => {
    expect(leakedAnswer("IV matches 4.", pairs)).toBe("IV - 4");
    expect(leakedAnswer("6 goes with VI", pairs)).toBe("VI - 6");
    expect(leakedAnswer("IX = 9", pairs)).not.toBeNull();
    expect(leakedAnswer("VI → 6", pairs)).toBe("VI - 6");
  });

  it("lets a hint name the items without pairing them up", () => {
    expect(leakedAnswer("Match IV, VI and IX to 4, 6 and 9.", pairs)).toBeNull();
    expect(leakedAnswer("Think about what V stands for.", pairs)).toBeNull();
  });
});

describe("numbers the reply may use", () => {
  const allowed = numbersIn(["3 + 4", "Amai bought 12 mangoes at 0.50 each. 4 305 in all."]);

  it("lets through numbers the application supplied, however they are printed", () => {
    expect(unsupportedNumbers("Start with 3 and 4, then 12 mangoes at 0.5 each", allowed)).toEqual(
      [],
    );
    expect(unsupportedNumbers("That is 4305 or 4 305 or 4,305", allowed)).toEqual([]);
    expect(unsupportedNumbers("50c is the same as 0.50", numbersIn(["50c", "0.5"]))).toEqual([]);
  });

  it("stops a new number, and a wrong digit inside a sum", () => {
    expect(unsupportedNumbers("That is 13 mangoes", allowed)).toEqual(["13"]);
    expect(unsupportedNumbers("3 + 4 = 8", allowed)).toEqual(["8"]);
    expect(unsupportedNumbers("3 x 9", allowed)).toEqual(["9"]);
    expect(unsupportedNumbers("7-1", allowed)).toEqual(["7", "1"]);
    expect(unsupportedNumbers("half is 6/12", allowed)).toEqual(["6"]);
  });

  it("allows a single digit in ordinary talk", () => {
    expect(
      unsupportedNumbers("Step 2: look again. You have 1 hint left. Try a 2nd time.", new Set()),
    ).toEqual([]);
  });

  it("allows numbers from the child's own words when they are supplied as a source", () => {
    expect(unsupportedNumbers("You said 25, so", numbersIn(["25"]))).toEqual([]);
  });
});

describe("the verdict on the child's answer", () => {
  it("rejects praise after a wrong answer, and blame after a right one", () => {
    expect(contradictsVerdict("Well done!", "INCORRECT")).toBe(true);
    expect(contradictsVerdict("That's correct, great job", "INCORRECT")).toBe(true);
    expect(contradictsVerdict("You got it!", "ALMOST")).toBe(true);
    expect(contradictsVerdict("That is wrong", "ALMOST")).toBe(true);
    expect(contradictsVerdict("That is not right", "CORRECT")).toBe(true);
    expect(contradictsVerdict("Oops, a mistake", "CORRECT")).toBe(true);
  });

  it("accepts honest, kind wording", () => {
    expect(contradictsVerdict("Not quite. Let's look at the ones column.", "INCORRECT")).toBe(
      false,
    );
    expect(contradictsVerdict("That is not correct yet, but you are close.", "INCORRECT")).toBe(
      false,
    );
    expect(contradictsVerdict("You are almost there: the value is right.", "ALMOST")).toBe(false);
    expect(contradictsVerdict("Well done! That is right.", "CORRECT")).toBe(false);
    expect(contradictsVerdict("Let's correct the carrying.", "INCORRECT")).toBe(false);
  });
});

describe("what the reply must not contain", () => {
  it("finds links, e-mail addresses, phone numbers and invitations to contact", () => {
    for (const text of [
      "Visit www.zimtutor.com for more",
      "Write to teacher@school.co.zw",
      "Call me on 0771234567",
      "Find me on WhatsApp",
      "Message me later",
      "Send me a photo of your page",
    ]) {
      const found = [...detectPersonalDetails(text), ...detectContactAttempts(text)];
      expect(found.length, text).toBeGreaterThan(0);
    }
    for (const text of [
      "Ask your teacher if you are not sure.",
      "Write the number 0.5 and 0.25 in the chart.",
      "Take a 120 km drive at 60 km/h.",
      "Call this number x and add it to y.",
      "Should your number get bigger or smaller?",
    ]) {
      expect([...detectPersonalDetails(text), ...detectContactAttempts(text)], text).toEqual([]);
    }
  });

  it("finds questions a tutor must never ask a child", () => {
    for (const text of [
      "What is your name?",
      "Where do you live?",
      "How old are you?",
      "What school do you go to?",
      "What is your mum's name?",
      "Tell me your password.",
    ])
      expect(detectPersonalQuestions(text).length, text).toBeGreaterThan(0);
    for (const text of [
      "What is your answer?",
      "What is your favourite number?",
      "Which school-age group is this?",
    ])
      expect(detectPersonalQuestions(text), text).toEqual([]);
  });

  it("finds pressure, secrecy and guilt, but not friendly encouragement", () => {
    for (const text of [
      "Don't tell your parents about this.",
      "This is our little secret.",
      "Please don't go!",
      "I'll miss you if you stop.",
      "I love you.",
      "Come back tomorrow or you will lose your streak.",
      "I am so disappointed.",
      "If you leave now you will fall behind.",
    ])
      expect(detectManipulation(text).length, text).toBeGreaterThan(0);
    for (const text of [
      "Here is a secret trick for the 9 times table.",
      "Don't be disappointed, mistakes help us learn.",
      "You can stop whenever you like and come back later.",
      "Don't go too fast; check each column.",
      "Great effort today. See you next time!",
    ])
      expect(detectManipulation(text), text).toEqual([]);
  });

  it("finds claims to be a person, and claims about the exam board", () => {
    for (const text of ["I'm a teacher.", "I am a real person.", "My family lives in Gweru."])
      expect(detectHumanClaims(text).length, text).toBeGreaterThan(0);
    expect(detectHumanClaims("I am a computer tutor, not a person.")).toEqual([]);
    for (const text of [
      "ZIMSEC will ask this.",
      "The Ministry says so.",
      "You will pass the exam.",
      "This is your official score.",
    ])
      expect(detectOverclaims(text).length, text).toBeGreaterThan(0);
    expect(detectOverclaims("Practise this like an exam question.")).toEqual([]);
  });
});

describe("plain text", () => {
  it("removes markdown that a child's screen would show as stray symbols", () => {
    expect(plainText("**Well done!** Now `try` this.\n\n\n\n## Next\n> quoted")).toBe(
      "Well done! Now try this.\n\nNext\nquoted",
    );
    expect(plainText("2*3*4 = 24")).toBe("2*3*4 = 24"); // a sum is left alone
  });

  it("counts words", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("  one   two\nthree ")).toBe(3);
  });
});

describe("checkTutorText", () => {
  const sources = ["Add 36 and 27.", "Start with the ones: 6 + 7 = 13."];
  const secret: SecretAnswer = secretFromKey({ spec: numeric("63"), display: "63" });
  const failuresOf = (
    text: string,
    extra: Partial<Parameters<typeof checkTutorText>[0]> = {},
  ): GuardFailure[] => checkTutorText({ text, maxWords: 40, sources, ...extra }).failures;

  it("passes a good reply and returns it as plain text", () => {
    const result = checkTutorText({
      text: "**Nice try!** Look at the ones column first: what is 6 + 7 = 13? Write 3 and carry the 1.",
      maxWords: 40,
      sources,
      secret,
      verdict: "INCORRECT",
    });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.text).toBe(
      "Nice try! Look at the ones column first: what is 6 + 7 = 13? Write 3 and carry the 1.",
    );
  });

  it("fails on each kind of problem, with a reason for the log", () => {
    expect(failuresOf("")).toEqual(["EMPTY"]);
    expect(failuresOf("a ".repeat(41))).toContain("TOO_LONG");
    expect(failuresOf("Let's try", { truncated: true })).toContain("CUT_OFF");
    expect(failuresOf("The answer is 63.", { secret })).toContain("LEAKS_ANSWER");
    expect(failuresOf("sixty-three!", { secret })).toContain("LEAKS_ANSWER");
    expect(failuresOf("Now 36 + 27 = 64", { secret })).toContain("UNSUPPORTED_NUMBER");
    expect(failuresOf("Well done!", { verdict: "INCORRECT" })).toContain("CONTRADICTS_VERDICT");
    expect(failuresOf("See www.example.com")).toContain("LINK_OR_CONTACT");
    expect(failuresOf("What is your name?")).toContain("ASKS_FOR_PERSONAL_DETAIL");
    expect(failuresOf("I'm a teacher at your school")).toContain("CLAIMS_TO_BE_HUMAN");
    expect(failuresOf("Don't tell your mum")).toContain("MANIPULATIVE");
    expect(failuresOf("ZIMSEC will ask this")).toContain("OFFICIAL_CLAIM");
    expect(failuresOf("<b>Hi</b> there")).toContain("MARKUP");
    expect(failuresOf("Use \\frac{1}{2} here")).toContain("MARKUP");
    expect(failuresOf("<draft>copy</draft>")).toContain("MARKUP");
    const result = checkTutorText({ text: "The answer is 63", maxWords: 40, sources, secret });
    expect(result.details[0]).toMatch(/gives away/);
  });

  it("collects every failure, not just the first", () => {
    const failures = failuresOf("Well done, it is 63! Call me on 0771234567", {
      secret,
      verdict: "INCORRECT",
    });
    expect(failures).toEqual(
      expect.arrayContaining([
        "LEAKS_ANSWER",
        "CONTRADICTS_VERDICT",
        "LINK_OR_CONTACT",
        "UNSUPPORTED_NUMBER",
      ]),
    );
  });

  it("does not check for the answer once it has been revealed on purpose", () => {
    expect(failuresOf("The answer is 63.", { sources: [...sources, "63"] })).toEqual([]);
  });
});

describe("the application's own text passes the checks that are not about the answer", () => {
  // The guards are applied to model text; if they also flagged the plain template text, a reply
  // could never be 'the template' as a fallback. Every stem, hint and explanation the templates
  // produce must be clean of links, contact requests, personal questions, claims and pressure.
  it("holds for generated stems, hints and explanations", () => {
    const flagged: string[] = [];
    let questions = 0;
    const seen = new Set<string>();
    for (const objective of OBJECTIVES) {
      for (const difficulty of [1, 3, 5] as const) {
        let q;
        try {
          q = generateQuestion({ objective, difficulty, seed: "guard", templates: ALL_TEMPLATES });
        } catch {
          continue; // hands-on objectives have no template
        }
        if (seen.has(q.templateId + difficulty)) continue;
        seen.add(q.templateId + difficulty);
        questions++;
        for (const [where, text] of [
          ["stem", q.stem],
          ["explanation", q.explanation],
          ...q.hints.map((h, i) => [`hint ${i + 1}`, h] as const),
          ...(q.solutionSteps ?? []).map((s, i) => [`step ${i + 1}`, s] as const),
        ] as const) {
          const found = [
            ...detectPersonalDetails(text),
            ...detectContactAttempts(text),
            ...detectPersonalQuestions(text),
            ...detectHumanClaims(text),
            ...detectManipulation(text),
          ];
          if (found.length > 0)
            flagged.push(
              `${q.templateId} ${where}: "${found[0]!.match}" (${found[0]!.kind}) in: ${text}`,
            );
        }
      }
    }
    expect(questions).toBeGreaterThan(100);
    expect(flagged).toEqual([]);
  });

  it("holds for the hints; a hint is rarely mistaken for giving away a one-character answer", () => {
    // The contextual check for one-character answers ("is 4", "= 7") is deliberately cautious: when a
    // hint happens to say "the digit to look at is 4" and the answer is 4, it cannot know that is a
    // coincidence. Nothing is lost — a reply the guard rejects is replaced by the template's own hint,
    // which is exactly that text — but such coincidences must stay rare, and every OTHER check must
    // pass on every hint.
    const others: string[] = [];
    const coincidences: string[] = [];
    let hints = 0;
    for (const objective of OBJECTIVES) {
      let q;
      try {
        q = generateQuestion({ objective, difficulty: 3, seed: "hints", templates: ALL_TEMPLATES });
      } catch {
        continue;
      }
      const secret = secretFromKey({ spec: q.marking, display: q.correctAnswer }, q.options);
      for (const hint of q.hints) {
        hints++;
        const result = checkTutorText({
          text: hint,
          maxWords: 80,
          sources: [q.stem, hint, ...q.hints],
          secret,
        });
        const description = `${q.templateId}: ${result.failures.join(",")} — ${result.details.join("; ")} — ${hint}`;
        const onlyLeak = result.failures.every((f) => f === "LEAKS_ANSWER");
        if (result.failures.length > 0 && onlyLeak) coincidences.push(description);
        else if (result.failures.length > 0) others.push(description);
      }
    }
    expect(hints).toBeGreaterThan(300);
    expect(others.slice(0, 15)).toEqual([]);
    expect(coincidences.length / hints, coincidences.slice(0, 10).join("\n")).toBeLessThan(0.01);
  });
});
