import { z } from "zod";

const envSchema = z.object({
  VITE_API_BASE_URL: z.string().min(1).default("/api/v1"),
  VITE_ENABLE_API_MOCKING: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /**
   * Departemen buku periode produksi. HARUS sama dengan
   * `PRODUCTION_DEPARTMENT_CODE` di backend: backend menilai tiap baris
   * terhadap buku departemen itu, jadi layar yang menampilkan atau membuat
   * buku departemen lain menawarkan buku "Terbuka" yang Simpan-nya tetap
   * ditolak. Default mengikuti keputusan #4 SPEC buku periode.
   */
  VITE_PRODUCTION_DEPARTMENT_CODE: z.string().trim().min(1).default("KARUNG"),
});

export const env = envSchema.parse({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_ENABLE_API_MOCKING: import.meta.env.VITE_ENABLE_API_MOCKING,
  VITE_PRODUCTION_DEPARTMENT_CODE: import.meta.env
    .VITE_PRODUCTION_DEPARTMENT_CODE,
});
