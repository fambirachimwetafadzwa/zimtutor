import type { Db } from "./types";

/**
 * Out-of-band administrator management (`npm run admin:promote`).
 *
 * Roles are never taken from anything a user can write: sign-ups are always parents, learners are
 * provisioned server-side, and an administrator exists only because an operator with direct database
 * access ran this. The application reads the role from `profiles.role`; `app_metadata.role` is kept
 * in step so a future JWT-claim check agrees with it.
 */

export type AdminChangeResult =
  | { status: "PROMOTED" | "ALREADY_ADMIN" | "REVOKED" | "NOT_ADMIN"; userId: string }
  | { status: "NOT_FOUND" }
  | { status: "REFUSED_LEARNER_ACCOUNT"; userId: string }
  | { status: "REFUSED_HAS_LEARNERS"; userId: string };

export async function setAdminRole(
  db: Db,
  email: string,
  options: { revoke?: boolean } = {},
): Promise<AdminChangeResult> {
  const normalised = email.trim().toLowerCase();
  const [user] = await db<Array<{ id: string; role: string | null }>>`
    select u.id, p.role::text as role
    from auth.users u left join public.profiles p on p.id = u.id
    where lower(u.email) = ${normalised}`;
  if (!user || user.role === null) return { status: "NOT_FOUND" };

  if (options.revoke) {
    if (user.role !== "admin") return { status: "NOT_ADMIN", userId: user.id };
    await db`update public.profiles set role = 'parent' where id = ${user.id}`;
    await db`update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'role' where id = ${user.id}`;
    return { status: "REVOKED", userId: user.id };
  }

  if (user.role === "admin") return { status: "ALREADY_ADMIN", userId: user.id };
  // A child's account must never become an administrator, and a parent with linked learners should
  // keep that role: use a separate account for administration.
  if (user.role === "student") return { status: "REFUSED_LEARNER_ACCOUNT", userId: user.id };
  const [links] = await db<
    Array<{ n: number }>
  >`select count(*)::int as n from public.guardianships where parent_id = ${user.id}`;
  if ((links?.n ?? 0) > 0) return { status: "REFUSED_HAS_LEARNERS", userId: user.id };

  await db`update public.profiles set role = 'admin' where id = ${user.id}`;
  await db`update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb where id = ${user.id}`;
  return { status: "PROMOTED", userId: user.id };
}
