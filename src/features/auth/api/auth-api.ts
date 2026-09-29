import { z } from "zod";

import { ApiClientError } from "../../../api/client/api-result";
import type { components } from "../../../api/generated/schema";
import { env } from "../../../config/env";

const sessionSnapshotSchema = z.object({
  user: z.object({
    userId: z.string().min(1),
    hrisUserId: z.number().int(),
    email: z.string(),
    displayName: z.string().min(1),
  }),
  permissions: z.array(z.string()),
  roles: z.array(z.string()),
  isSuperAdmin: z.boolean(),
  expiresAt: z.string().min(1),
  csrfToken: z.string().min(1),
});
const logoutResponseSchema: z.ZodType<components["schemas"]["LogoutResponse"]> =
  z.object({ success: z.literal(true) });

export type AuthSession = z.infer<typeof sessionSnapshotSchema>;

export interface PasswordLoginInput {
  pin: string;
  password: string;
  rememberMe: boolean;
}

export interface SsoLoginInput {
  rememberMe: boolean;
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined;
  }

  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function authRequest<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${env.VITE_API_BASE_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(init.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiClientError({
      status: 0,
      payload: {
        error: {
          code: "NETWORK_ERROR",
          message:
            "Tidak dapat terhubung ke server. Periksa koneksi lalu coba lagi.",
        },
      },
    });
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw new ApiClientError({ status: response.status, payload });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError({
      status: 502,
      payload: {
        error: {
          code: "INVALID_AUTH_RESPONSE",
          message: "Respons autentikasi dari server tidak dapat diproses.",
        },
      },
    });
  }

  return parsed.data;
}

export function loginWithPassword(input: PasswordLoginInput) {
  return authRequest(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({
        email: input.pin,
        password: input.password,
        rememberMe: input.rememberMe,
      }),
    },
    sessionSnapshotSchema,
  );
}

export function loginWithSso(input: SsoLoginInput) {
  return authRequest(
    "/auth/sso-login",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    sessionSnapshotSchema,
  );
}

export function getSession() {
  return authRequest("/auth/session", { method: "GET" }, sessionSnapshotSchema);
}

export function logout() {
  return authRequest("/auth/logout", { method: "POST" }, logoutResponseSchema);
}
