import { describe, expect, it } from "vitest";
import {
  ALLOWED_FIELDS,
  describeError,
  routeOnly,
  safeFields,
  scrubStack,
  scrubText,
} from "../../src/lib/monitoring/scrub";

describe("scrubbing a message", () => {
  const cases: Array<[string, string, string[]]> = [
    [
      "an email address",
      "could not send to chipo.moyo@example.co.zw now",
      ["chipo.moyo", "example.co.zw"],
    ],
    [
      "a learner's made-up sign-in address",
      "no user chipo123@learner.zimtutor.invalid found",
      ["chipo123"],
    ],
    ["a Zimbabwean mobile number", "my number is 0771234567 call me", ["0771234567"]],
    ["a number with spaces", "ring 077 123 4567 please", ["077 123 4567", "4567"]],
    ["a number with dashes", "ring 077-123-4567 please", ["123-4567"]],
    ["an international number", "ring +263 77 123 4567 please", ["263 77", "4567"]],
    ["a landline in brackets", "ring (0242) 123456 please", ["123456"]],
    ["an IPv4 address", "refused for 41.220.10.5 at the door", ["41.220.10.5"]],
    ["an IPv6 address", "refused for 2001:db8:abcd:12::1 at the door", ["2001:db8"]],
    [
      "a UUID",
      "learner 3f2b8c1e-7d4a-4b9e-a1c2-0123456789ab not found",
      ["3f2b8c1e", "0123456789ab"],
    ],
    [
      "a JWT",
      "bad token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF_ghi-123 given",
      ["eyJhbGci", "abcDEF"],
    ],
    ["a bearer token", "Authorization: Bearer abcdefghijklmnop1234567890", ["abcdefghijklmnop"]],
    ["an API key", "invalid key sk-ant-api03-AbCdEfGhIjKlMnOpQrSt", ["AbCdEf"]],
    ["a new-style database key", "using sb_secret_AbCdEfGhIjKlMnOp12345 failed", ["AbCdEf"]],
    [
      "the row a database error is about",
      "duplicate key: Key (username)=(chipo) already exists.",
      ["chipo"],
    ],
    [
      "a web address with a query and a login",
      "GET https://user:pw@api.example.test/v1/rows?learner=abc&q=hello#top failed",
      ["user:pw", "learner=abc", "hello", "#top"],
    ],
    [
      "a child's sentence in quotes",
      'Invalid value "why do we carry the one my name is Chipo"',
      ["why do we carry", "Chipo"],
    ],
    ["a sentence in single quotes", "bad input 'my gogo lives in Bulawayo'", ["gogo", "Bulawayo"]],
  ];

  it.each(cases)("removes %s", (_name, text, gone) => {
    const out = scrubText(text);
    for (const piece of gone) expect(out, `"${piece}" in "${out}"`).not.toContain(piece);
  });

  it("keeps what helps to find the fault", () => {
    expect(scrubText('relation "public.tutor_sessions" does not exist')).toBe(
      'relation "public.tutor_sessions" does not exist',
    );
    expect(scrubText("ECONNREFUSED 127.0.0.1:54321")).toBe("ECONNREFUSED [address]:54321");
    expect(scrubText("rate_limit_hit: permission denied for function")).toContain(
      "permission denied",
    );
    expect(scrubText("HTTP 429 from the provider")).toBe("HTTP 429 from the provider");
    expect(scrubText("code PT409 raised")).toBe("code PT409 raised");
    expect(scrubText("TypeError: Cannot read properties of undefined")).toContain("TypeError");
  });

  it("keeps the host and path of a web address, and nothing after the question mark", () => {
    expect(scrubText("fetch https://api.example.test/v1/rows?select=*&learner=3 failed")).toBe(
      "fetch https://api.example.test/v1/rows failed",
    );
  });

  it("is cut to a short length, whatever it was", () => {
    const out = scrubText("word ".repeat(500));
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.endsWith("…")).toBe(true);
    expect(scrubText("abc".repeat(100), 20)).toHaveLength(20);
  });

  it("does not leave a trace of the original in the pieces that replace it", () => {
    const out = scrubText("a@b.co 0771234567 41.1.2.3 sk-aaaaaaaaaaaaaaaaaaaa");
    expect(out).toBe("[email] [number] [address] [key]");
  });

  it("copes with an empty message", () => {
    expect(scrubText("")).toBe("");
  });
});

describe("describing an error", () => {
  it("gives its kind, a scrubbed message, plain frames and a short code", () => {
    const error = Object.assign(
      new TypeError("no row for chipo@example.test (id 3f2b8c1e-7d4a-4b9e-a1c2-0123456789ab)"),
      {
        code: "PT409",
      },
    );
    const described = describeError(error);
    expect(described.name).toBe("TypeError");
    expect(described.message).toBe("no row for [email] (id [id])");
    expect(described.code).toBe("PT409");
    expect(described.frames.length).toBeGreaterThan(0);
    for (const frame of described.frames) expect(frame.startsWith("at ")).toBe(true);
  });

  it("does not carry the error's cause, its details or its other properties", () => {
    const error = Object.assign(new Error("failed"), {
      details: "Key (username)=(chipo) already exists",
      cause: new Error("the child wrote: my name is Chipo"),
      body: { text: "my phone is 0771234567" },
    });
    expect(JSON.stringify(describeError(error))).not.toMatch(/chipo|0771234567|child wrote/i);
  });

  it("ignores a code that is not a short code, and a name that is not a name", () => {
    const odd = Object.assign(new Error("x"), { code: "my phone is 0771234567" });
    odd.name = "a very odd name with spaces and 0771234567";
    const described = describeError(odd);
    expect(described.code).toBeUndefined();
    expect(described.name).toBe("Error");
  });

  it("says only what kind of thing was thrown when it was not an error", () => {
    expect(describeError("the child said 0771234567")).toEqual({
      name: "NonError",
      message: "a string was thrown",
      frames: [],
    });
    expect(describeError({ secret: "x" }).message).toBe("a object was thrown");
    expect(describeError(null).message).toBe("a object was thrown");
  });
});

describe("a stack", () => {
  it("keeps only frames, and no more than thirty", () => {
    const stack = [
      "Error: my phone is 0771234567",
      ...Array.from({ length: 50 }, (_, i) => `    at fn${i} (/app/src/x.ts:${i}:1)`),
    ].join("\n");
    const frames = scrubStack(stack);
    expect(frames).toHaveLength(30);
    expect(frames[0]).toBe("at fn0 (/app/src/x.ts:0:1)");
    expect(frames.join("\n")).not.toContain("0771234567");
    expect(scrubStack(undefined)).toEqual([]);
  });

  it("takes a login out of a web address in a frame", () => {
    expect(
      scrubStack("Error\n    at f (https://user:pw@host.test/a.js?x=1:2:3)").join(),
    ).not.toContain("user:pw");
  });
});

describe("the facts that go with a report", () => {
  it("keeps listed facts that are plain, and drops everything else", () => {
    expect(
      safeFields({
        bucket: "tutor.ask",
        status: 429,
        retryable: true,
        route: "/student/learn/[objectiveId]",
        learnerId: "3f2b8c1e-7d4a-4b9e-a1c2-0123456789ab",
        email: "a@b.co",
        text: "why do we carry the one",
        grade: 5,
        count: Number.NaN,
      }),
    ).toEqual({
      bucket: "tutor.ask",
      status: 429,
      route: "/student/learn/[objectiveId]",
      grade: 5,
    });
  });

  it("drops a listed fact whose value is a sentence, however plain its words", () => {
    expect(safeFields({ reason: "the child asked why we carry the one" })).toEqual({});
    expect(safeFields({ reason: "model_unavailable" })).toEqual({ reason: "model_unavailable" });
  });

  it("never lets an identifying key through, whatever its value", () => {
    for (const key of [
      "learner_id",
      "learnerId",
      "user",
      "email",
      "name",
      "text",
      "message",
      "ip",
      "username",
      "content",
    ])
      expect(ALLOWED_FIELDS.has(key), key).toBe(false);
  });

  it("drops a long string and a string with odd characters", () => {
    expect(safeFields({ reason: "x".repeat(81) })).toEqual({});
    expect(safeFields({ reason: "phone 0771234567" })).toEqual({});
    expect(safeFields({ reason: "<script>" })).toEqual({});
    expect(safeFields(undefined)).toEqual({});
  });
});

describe("a route", () => {
  it("is the route without what was asked after it", () => {
    expect(routeOnly("/student/learn/G5-OPS?next=/x&name=chipo")).toBe("/student/learn/G5-OPS");
    expect(routeOnly("/parent#top")).toBe("/parent");
    expect(routeOnly(undefined)).toBeUndefined();
  });
});
