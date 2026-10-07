export const APP_ROLES = ["student", "parent", "admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

/** Where each role lands after signing in. */
export function homePathForRole(role: AppRole): string {
  switch (role) {
    case "student":
      return "/student";
    case "parent":
      return "/parent";
    case "admin":
      return "/admin";
  }
}

/** Section of the site a path belongs to, if it is role-restricted. */
export function roleForPath(pathname: string): AppRole | null {
  if (pathname === "/student" || pathname.startsWith("/student/")) return "student";
  if (pathname === "/parent" || pathname.startsWith("/parent/")) return "parent";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  return null;
}

/** Whether a signed-in user with `role` may view `pathname`. Unrestricted paths are open to all. */
export function canAccessPath(role: AppRole, pathname: string): boolean {
  const required = roleForPath(pathname);
  return required === null || required === role;
}
