import createClient from "openapi-fetch";

import type { paths } from "../generated/schema";
import { env } from "../../config/env";

export const apiClient = createClient<paths>({
  baseUrl: env.VITE_API_BASE_URL,
  credentials: "include",
  headers: {
    Accept: "application/json",
  },
});
