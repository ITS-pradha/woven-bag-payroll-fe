import type { AuthSession } from "../api/auth-api";

type UiSession = Pick<AuthSession, "permissions" | "isSuperAdmin">;

/**
 * Controls presentation only. The backend independently authorizes every API
 * request from the authenticated session.
 */
export function hasUiCapability(
  session: UiSession | null | undefined,
  ...required: string[]
) {
  if (!session) return false;
  if (session.isSuperAdmin) return true;
  if (session.permissions.includes("bag.all.access")) return true;
  return required.some((permission) =>
    session.permissions.includes(permission),
  );
}
