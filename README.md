# Woven Payroll Tools — Frontend

Frontend React untuk payroll operator mesin Lohia/LDMS. Proyek memakai pendekatan contract-first agar frontend dan backend dapat dikembangkan paralel.

## Prasyarat

- Node.js 24.15 atau lebih baru.
- Backend payroll pada `http://127.0.0.1:4000` jika mock dimatikan.

## Menjalankan proyek

```bash
cp .env.example .env.local
npm install
npm run api:generate
npm run dev
```

Aplikasi tersedia di `http://127.0.0.1:4173` dan request `/api/*` diteruskan ke backend lokal port 4000.

Untuk menggunakan mock browser:

```dotenv
VITE_ENABLE_API_MOCKING=true
```

## Quality gates

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Install browser Playwright satu kali jika belum tersedia:

```bash
npm run playwright:install
```

## Kontrak API

Type API dihasilkan ke `src/api/generated/schema.ts` dari:

```text
../../../../prototype/docs/openapi-v1.yaml
```

Jangan mengedit file generated secara manual. Saat OpenAPI berubah, jalankan kembali `npm run api:generate` dan review diff.

## MCP proyek

`.mcp.json` menyiapkan Context7 untuk dokumentasi library terkini dan Chrome DevTools dengan profile terisolasi untuk verifikasi browser. Tidak ada API key yang disimpan di repository.

## Struktur

```text
src/app/             providers, query client, router, dan shell
src/routes/          lazy route modules
src/features/        implementasi domain per fitur
src/components/      komponen lintas fitur
src/design-system/   semantic tokens dan global styles
src/api/generated/   type hasil OpenAPI
src/api/client/      transport dan normalisasi error
src/test/            setup dan mock boundary
e2e/                 alur Playwright
```

Aturan kerja lengkap berada di `AGENTS.md`.
