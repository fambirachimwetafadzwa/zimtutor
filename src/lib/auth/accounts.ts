/**
 * Removing accounts, and changing a child's password: what a parent can do about the accounts they
 * look after. The side effects are injected as "ports" (as in learners.ts) so the rules can be tested
 * without a live service; the Supabase-backed ports are in accounts.server.ts.
 *
 * Deleting an account means deleting the sign-in identity. Everything else about a person (their
 * profile, their progress, every lesson, message, answer and practice paper) is removed by the
 * database in the same stroke, because each of those records is tied to the profile and goes with
 * it. That is checked, table by table, in tests/db/account-deletion.test.ts: a new table that kept a
 * child's data after their account was deleted would fail it.
 *
 * Callers MUST have authenticated the parent first; `parentId` always comes from the session.
 */

export interface AccountPorts {
  /** True when this parent is a guardian of this learner. */
  isGuardian(parentId: string, learnerId: string): Promise<boolean>;
  /** The learners this parent guards, with how many guardians each has (this parent included). */
  guardedLearners(parentId: string): Promise<Array<{ learnerId: string; guardians: number }>>;
  /** A learner's username, or null if there is no such learner. */
  learnerUsername(learnerId: string): Promise<string | null>;
  deleteAuthUser(id: string): Promise<void>;
  setPassword(id: string, password: string): Promise<void>;
}

export type RemoveLearnerResult = { ok: true } | { ok: false; error: "NOT_FOUND" | "FAILED" };

/**
 * Delete one learner's account and everything saved about it. Only one of their guardians may; to
 * anyone else, the learner does not exist.
 */
export async function removeLearner(
  ports: AccountPorts,
  parentId: string,
  learnerId: string,
): Promise<RemoveLearnerResult> {
  if (!(await ports.isGuardian(parentId, learnerId))) return { ok: false, error: "NOT_FOUND" };
  try {
    await ports.deleteAuthUser(learnerId);
    return { ok: true };
  } catch {
    return { ok: false, error: "FAILED" };
  }
}

export type RemoveFamilyResult =
  { ok: true; learnersRemoved: number } | { ok: false; error: "FAILED"; learnersRemoved: number };

/**
 * Delete a parent's own account, and the account of every child for whom they are the only
 * guardian (a child with another guardian stays, with that guardian). The children go first: if
 * something fails part-way, the parent still exists and can try again, instead of leaving children
 * whom nobody can reach to delete.
 */
export async function removeFamily(
  ports: AccountPorts,
  parentId: string,
): Promise<RemoveFamilyResult> {
  const guarded = await ports.guardedLearners(parentId);
  let removed = 0;
  try {
    for (const learner of guarded.filter((l) => l.guardians <= 1)) {
      await ports.deleteAuthUser(learner.learnerId);
      removed += 1;
    }
    await ports.deleteAuthUser(parentId);
    return { ok: true, learnersRemoved: removed };
  } catch {
    return { ok: false, error: "FAILED", learnersRemoved: removed };
  }
}

export type ChangePasswordResult =
  { ok: true; username: string } | { ok: false; error: "NOT_FOUND" | "FAILED" };

/** Give a learner a new password. Only one of their guardians may. */
export async function changeLearnerPassword(
  ports: AccountPorts,
  parentId: string,
  learnerId: string,
  password: string,
): Promise<ChangePasswordResult> {
  if (!(await ports.isGuardian(parentId, learnerId))) return { ok: false, error: "NOT_FOUND" };
  const username = await ports.learnerUsername(learnerId);
  if (!username) return { ok: false, error: "NOT_FOUND" };
  try {
    await ports.setPassword(learnerId, password);
    return { ok: true, username };
  } catch {
    return { ok: false, error: "FAILED" };
  }
}
