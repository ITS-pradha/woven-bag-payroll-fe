/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_ENABLE_API_MOCKING?: string;
  readonly VITE_PRODUCTION_DEPARTMENT_CODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
