import {
  learnerEmail,
  MAX_LEARNERS_PER_PARENT,
  type CreateLearnerInput,
} from "@/lib/auth/credentials";

/**
 * Creating a learner spans the Auth API (create the sign-in identity) and the database (profile +
 * guardianship). That cannot be a single transaction, so this orchestration makes the sequence
 * safe by COMPENSATION: if the database step fails, the freshly created auth user is deleted, so
 * we never leave a sign-in identity with no profile.
 *
 * The side-effecting operations are injected as "ports" so the logic is unit-testable without a
 * live Supabase; the Supabase-backed implementation is in learners.server.ts.
 */

export type PortFailure = "USER_EXISTS" | "USERNAME_TAKEN" | "LEARNER_LIMIT_REACHED";

export class PortError extends Error {
  constructor(
    readonly failure: PortFailure,
    message?: string,
  ) {
    super(message ?? failure);
    this.name = "PortError";
  }
}

export interface LearnerProvisioningPorts {
  createAuthUser(input: { email: string; password: string; displayName: string }): Promise<{ id: string }>;
  deleteAuthUser(id: string): Promise<void>;
  provisionProfile(input: {
    learnerId: string;
    parentId: string;
    grade: number;
    username: string;
    maxLearners: number;
  }): Promise<void>;
}

export type ProvisionResult =
  | { ok: true; learnerId: string; username: string }
  | { ok: false; error: "USERNAME_TAKEN" | "LEARNER_LIMIT_REACHED" | "UNKNOWN" };

export async function provisionLearner(
  ports: LearnerProvisioningPorts,
  parentId: string,
  input: CreateLearnerInput,
  onCompensationFailure: (id: string, error: unknown) => void = () => {},
): Promise<ProvisionResult> {
  let created: { id: string };
  try {
    created = await ports.createAuthUser({
      email: learnerEmail(input.username),
      password: input.password,
      displayName: input.displayName,
    });
  } catch (error) {
    if (error instanceof PortError && (error.failure === "USER_EXISTS" || error.failure === "USERNAME_TAKEN")) {
      return { ok: false, error: "USERNAME_TAKEN" };
    }
    return { ok: false, error: "UNKNOWN" };
  }

  try {
    await ports.provisionProfile({
      learnerId: created.id,
      parentId,
      grade: input.grade,
      username: input.username,
      maxLearners: MAX_LEARNERS_PER_PARENT,
    });
  } catch (error) {
    // Compensate FIRST so no orphaned sign-in identity survives, whatever went wrong.
    try {
      await ports.deleteAuthUser(created.id);
    } catch (cleanupError) {
      onCompensationFailure(created.id, cleanupError);
    }
    if (error instanceof PortError) {
      if (error.failure === "LEARNER_LIMIT_REACHED") return { ok: false, error: "LEARNER_LIMIT_REACHED" };
      if (error.failure === "USERNAME_TAKEN" || error.failure === "USER_EXISTS") {
        return { ok: false, error: "USERNAME_TAKEN" };
      }
    }
    return { ok: false, error: "UNKNOWN" };
  }

  return { ok: true, learnerId: created.id, username: input.username };
}
