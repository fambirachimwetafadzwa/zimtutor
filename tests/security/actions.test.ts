import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every server action is an address anyone can post to, whatever the page that shows its button
 * looks like. So each one must find out who is asking, from the signed-in session, before it does
 * anything. This reads the action files and holds each exported action to that: the only ones that
 * do not check are the three that exist so that a visitor can sign in, sign up or sign out.
 */

const DIRECTORY = path.resolve("src/app/actions");
const PUBLIC_ACTIONS = new Map([
  ["loginAction", "a visitor signing in"],
  ["signUpAction", "a visitor making a parent account"],
  ["signOutAction", "signing out ends the session; it needs no one to be known"],
]);
const GUARD = /\brequireRole\(/;

interface Action {
  file: string;
  name: string;
  body: string;
}

function actions(): Action[] {
  const found: Action[] = [];
  for (const file of fs.readdirSync(DIRECTORY).filter((f) => f.endsWith(".ts"))) {
    const source = fs.readFileSync(path.join(DIRECTORY, file), "utf8");
    const starts = [...source.matchAll(/^export async function (\w+)\(/gm)];
    starts.forEach((match, i) => {
      const end = starts[i + 1]?.index ?? source.length;
      found.push({ file, name: match[1]!, body: source.slice(match.index, end) });
    });
  }
  return found;
}

describe("server actions", () => {
  const all = actions();

  it("are found (so that this test is looking at something)", () => {
    expect(all.length).toBeGreaterThan(10);
    expect(all.map((a) => a.name)).toEqual(
      expect.arrayContaining(["loginAction", "lessonAction", "saveAnswerAction"]),
    );
  });

  it("each begin with the marker that makes a file's exports actions, and nothing else is exported from it", () => {
    for (const file of fs.readdirSync(DIRECTORY).filter((f) => f.endsWith(".ts"))) {
      const source = fs.readFileSync(path.join(DIRECTORY, file), "utf8");
      expect(source.trimStart().startsWith('"use server"'), file).toBe(true);
      // only async functions (and types) may be exported from a file of actions
      const exported = [...source.matchAll(/^export (?!type |interface )(\w+)(?: (\w+))?/gm)];
      for (const match of exported) {
        expect(`${match[1]} ${match[2]}`.startsWith("async function"), `${file}: ${match[0]}`).toBe(
          true,
        );
      }
    }
  });

  it("check who is asking before anything else, unless they exist for a visitor", () => {
    for (const action of all) {
      if (PUBLIC_ACTIONS.has(action.name)) continue;
      expect(
        GUARD.test(action.body),
        `${action.file}: ${action.name} does not call requireRole`,
      ).toBe(true);
    }
  });

  it("check first: the guard is the first thing an action does that is not reading its own input", () => {
    for (const action of all) {
      if (PUBLIC_ACTIONS.has(action.name)) continue;
      const guard = action.body.search(GUARD);
      // nothing that touches data comes before it
      const before = action.body.slice(0, guard);
      expect(before, `${action.name}`).not.toMatch(/createSupabase|create\w*Deps\(|await \w+\(/);
    }
  });

  it("name only the three public actions as exceptions, and all three exist", () => {
    const names = new Set(all.map((a) => a.name));
    for (const name of PUBLIC_ACTIONS.keys()) expect(names.has(name), name).toBe(true);
  });

  it("never take the acting user's id from what the browser sent", () => {
    for (const action of all) {
      expect(action.body, action.name).not.toMatch(/learnerId:\s*(parsed|input|formData)/);
      expect(action.body, action.name).not.toMatch(
        /formData\.get\(["'](?:userId|learnerId|parentId)["']\)/,
      );
    }
  });
});
