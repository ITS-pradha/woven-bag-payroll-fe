# Woven Payroll Tools — Frontend

Frontend aplikasi payroll operator karung untuk mesin Lohia/LDMS. Aplikasi ini menggantikan alur Google Sheets yang sudah lambat, tetapi pengalaman input pada menu **Manual Data** harus tetap terasa seperti spreadsheet: cepat, dapat diedit langsung, mendukung seleksi baris, serta copy/paste satu atau banyak baris.

Dokumen ini berlaku untuk seluruh isi folder `frontend/`.

## Sumber Kebenaran dan Urutan Prioritas

Sebelum mengerjakan fitur, baca hanya dokumen yang relevan dengan tugas saat itu:

1. `AGENTS.md` ini untuk aturan frontend.
2. `/Users/muhnasrul/Documents/Project-PKP/prototype/docs/specification-v1.md` untuk aturan bisnis.
3. `/Users/muhnasrul/Documents/Project-PKP/prototype/docs/openapi-v1.yaml` untuk kontrak HTTP. OpenAPI adalah sumber kebenaran request, response, error, enum, dan pagination.
4. `/Users/muhnasrul/Documents/Project-PKP/prototype/docs/api-contract-v1.md` untuk penjelasan perilaku API.
5. `/Users/muhnasrul/Documents/Project-PKP/prototype/docs/decisions/` untuk keputusan arsitektur yang sudah dikunci.
6. `/Users/muhnasrul/Documents/Project-PKP/prototype/` sebagai referensi alur dan tampilan, bukan sebagai sumber kontrak atau kode produksi.
7. Implementasi aktual dan test yang sudah ada di frontend.

Jika OpenAPI, dokumen bisnis, prototype, dan perilaku backend berbeda, jangan menebak atau membuat workaround diam-diam. Catat perbedaannya dan minta keputusan manusia. Jangan mengubah kontrak frontend secara sepihak agar mengikuti response backend yang menyimpang.

## Batas Tanggung Jawab

- Folder ini hanya untuk frontend. Backend dikerjakan terpisah oleh Claude di `../backend/`.
- Jangan mengubah isi `../backend/`, DDL, formula payroll, atau OpenAPI tanpa permintaan dan persetujuan eksplisit.
- Frontend tidak menghitung payroll sebagai sumber kebenaran. Perhitungan, validasi final, idempotency, dan otorisasi tetap milik backend.
- Browser tidak memanggil HRIS secara langsung. Semua integrasi HRIS melalui backend payroll agar credential, audit, dan aturan konfirmasi tetap aman.
- Bila endpoint belum tersedia, gunakan mock yang mengikuti OpenAPI; jangan menciptakan kontrak sementara yang berbeda.

## Konteks Domain yang Tidak Boleh Hilang

- Menu utama: **Manual Data**, **Detail**, **Summary**, dan **Konfigurasi Harga**. Menu **LDMS Data** dihapus atas permintaan pemilik produk (2026-09-29); halamannya dulu hanya placeholder. Endpoint `/ldms-imports` di backend tidak ikut dihapus.
- `Manual Data` adalah sumber data produksi utama. Data hasil impor LDMS pada akhirnya masuk atau memperbarui data ini.
- Kunci unik data produksi adalah kombinasi `(shiftStart, shiftEnd, station)`.
- `station` adalah nomor mesin Lohia.
- Identitas karyawan hanya `pin`. Jangan membuat atau memakai `employeeId`, `employeeNo`, maupun identifier pengganti.
- PIN unik selamanya, tidak pernah dipakai ulang setelah karyawan resign.
- UI menampilkan nama karyawan sebagai label assignee, tetapi menyimpan/mengirim `pin` sebagai identifier. Editor assignee wajib memiliki pencarian dan pilihan karyawan yang tersedia.
- Attendance hanya boleh tampil/dipakai setelah dikonfirmasi HRD. Data yang belum dikonfirmasi harus dianggap tidak tersedia bagi admin payroll.
- Tarif bersifat effective-dated. Perubahan tarif tidak boleh mengubah payroll historis yang telah dikunci.
- Payroll berstatus `LOCKED` bersifat immutable; UI harus menonaktifkan aksi ilegal dan tetap menangani penolakan server.
- Nominal dan nilai desimal dari API adalah string decimal. Jangan mengonversinya ke JavaScript `number` untuk perhitungan uang.
- Nilai `0` adalah nilai sah, bukan `null`, kosong, atau falsy yang boleh dibuang.
- Timestamp memakai ISO 8601 dengan offset. Presentasi waktu mengikuti `Asia/Jakarta`, tetapi payload tetap mengikuti kontrak API.

## Tech Stack Standar

Kecuali ada keputusan baru yang disetujui:

- React 19 + TypeScript strict + Vite.
- Univer untuk grid Manual Data dan interaksi spreadsheet.
- TanStack Query untuk server state, cache, mutation, optimistic update, dan invalidation.
- React Router untuk routing dan URL state.
- Zod untuk validasi input UI di boundary. Jangan menduplikasi OpenAPI secara manual.
- Tailwind CSS dengan design tokens untuk styling.
- Client dan type API dihasilkan dari `openapi-v1.yaml`.
- Vitest + React Testing Library untuk unit/component test.
- MSW untuk mock API berbasis kontrak.
- Playwright untuk alur kritis end-to-end.

Gunakan package manager yang ditentukan lockfile. Jika frontend belum memiliki lockfile ketika pertama kali diinisialisasi, gunakan npm agar konsisten dengan backend. Jangan menambah dependency tanpa memeriksa kebutuhan, maintenance, lisensi, ukuran bundle, dan apakah platform yang sudah dipilih sebenarnya telah menyediakan fitur tersebut.

## Skills Wajib Sesuai Tugas

Jika skill berikut tersedia pada agen, baca `SKILL.md`-nya sebelum bertindak dan gunakan hanya saat relevan:

- `frontend-ui-engineering`: wajib untuk membangun atau mengubah halaman, komponen, design system, interaksi, responsive behavior, dan aksesibilitas.
- `browser-testing-with-devtools`: wajib setelah perubahan UI untuk memeriksa runtime, DOM, console, network, keyboard flow, dan tampilan nyata di browser.
- `performance-optimization`: wajib untuk grid, tabel, pencarian assignee, bulk paste, import status, summary, dan semua layar dengan data besar.
- `test-driven-development`: wajib untuk perubahan behavior atau perbaikan bug; tulis test gagal lebih dahulu bila memungkinkan.
- `api-and-interface-design`: wajib saat kontrak frontend-backend, generated client, adapter API, atau public component interface berubah.
- `code-review-and-quality`: jalankan sebelum menyatakan perubahan siap merge.
- `git-workflow-and-versioning`: gunakan ketika membuat commit, branch, release, atau changelog.

Skill adalah pedoman proses, bukan izin untuk memperluas scope. Jika skill tidak tersedia, ikuti aturan ekuivalen yang tertulis di dokumen ini.

## Dokumentasi Resmi melalui MCP

Jangan mengandalkan ingatan model untuk API React atau library yang dapat berubah.

1. Sebelum memakai API React baru atau mengubah pola hooks, gunakan MCP dokumentasi yang tersedia—prioritaskan Context7 atau connector dokumentasi resmi—untuk mencari dokumentasi versi yang tercantum di `package.json`.
2. Resolve library/package terlebih dahulu, lalu ajukan pertanyaan yang spesifik. Contoh: aturan cleanup `useEffect`, external store, transition, atau error boundary pada React 19.
3. Prioritaskan sumber primer: `react.dev` dan dokumentasi resmi library. Untuk Univer, gunakan MCP `univer-docs` terlebih dahulu; sumbernya adalah indeks resmi `https://docs.univer.ai/llms.txt`. Untuk TanStack Query, React Router, Vite, Zod, dan Tailwind, gunakan dokumentasi resmi masing-masing melalui MCP bila tersedia.
4. Saat memakai `univer-docs`, cari halaman Sheets yang relevan lalu ambil hanya halaman yang diperlukan. Cocokkan jawaban dengan Univer `0.25.1` di `package.json`; jika dokumentasi terbaru berbeda, cari dokumentasi arsip versi 0.25 dan jangan menyalin API versi baru secara langsung.
5. Jangan memakai blog, snippet Stack Overflow, atau contoh versi lama jika dokumentasi resmi menjawab masalahnya.
6. Jika MCP dokumentasi tidak tersedia, gunakan dokumentasi resmi di web dan nyatakan fallback tersebut pada laporan kerja.
7. Bila keputusan implementasi bergantung pada detail API yang tidak stabil, sertakan tautan dokumentasi resmi dalam catatan perubahan atau PR.

## Baseline Praktik React

Ikuti Rules of React dan pola yang direkomendasikan komunitas React saat ini:

- Gunakan function component dan Hooks; jangan membuat class component baru.
- Render harus pure. Jangan melakukan fetch, mutation, subscription, menulis storage, atau mengubah object di dalam render.
- Jangan memanggil Hook secara kondisional atau dari fungsi biasa.
- Jangan menonaktifkan rule `react-hooks/exhaustive-deps`. Perbaiki dependency atau desain effect-nya.
- `useEffect` hanya untuk sinkronisasi dengan sistem eksternal. Derived state dihitung saat render; aksi akibat event dikerjakan di event handler.
- Hindari state duplikat. Simpan sumber minimal dan derive sisanya.
- Perlakukan props dan state sebagai immutable.
- Gunakan key stabil dari data, bukan index baris, terutama pada data yang bisa diurutkan, ditempel, disisipkan, atau dihapus.
- Pisahkan server state, URL state, form/grid draft, dan ephemeral UI state. Jangan menyalin cache TanStack Query ke global store.
- Gunakan composition dan komponen terfokus. Pisahkan data orchestration dari presentational component jika itu memperjelas tanggung jawab.
- Jangan memakai Context sebagai pengganti semua state. Context hanya untuk data lintas subtree yang read-heavy dan jarang berubah, seperti auth, theme, dan locale.
- Jangan menambahkan Redux/Zustand sebelum ada kebutuhan state lintas fitur yang nyata dan terukur.
- Gunakan `memo`, `useMemo`, dan `useCallback` hanya ketika profiler atau referential contract membuktikan kebutuhan; bukan secara otomatis.
- Tangani loading, empty, error, unauthorized, forbidden, conflict, offline, dan retry state secara eksplisit.
- Pasang error boundary minimal di level route/fitur berat.
- Gunakan named exports untuk component dan hook aplikasi. Lazy route boleh memakai adapter bila library membutuhkan default export.
- TypeScript harus strict. Hindari `any`, non-null assertion, dan type cast yang hanya membungkam compiler.

## Arsitektur Frontend

Gunakan struktur feature-first dan dependency satu arah:

```text
src/
  app/                         composition root, providers, router
  routes/                      route modules dan route-level boundaries
  features/
    manual-data/
    detail/
    summary/
    rates/
  components/                  komponen UI lintas fitur yang benar-benar reusable
  design-system/               tokens dan primitives
  api/
    generated/                 hasil generator OpenAPI; jangan diedit manual
    client/                    transport, auth, error normalization
  lib/                         utilitas generik tanpa pengetahuan domain
  test/                        setup, fixtures, MSW handlers
```

Aturan dependency:

```text
route -> feature -> shared UI / api client -> generated contracts
```

- `api/generated/` tidak boleh mengimpor feature atau UI.
- Feature tidak boleh saling mengimpor file internal. Promosikan contract yang benar-benar shared ke lokasi netral.
- Jangan membuat satu `utils.ts`, `types.ts`, atau store global raksasa.
- Colocate component, hook, test, dan fixture yang hanya dipakai satu feature.
- Adapter API bertugas menormalisasi transport/error, bukan menyisipkan business rule payroll.

## Contract-First dan Kerja Paralel dengan Backend

- Setiap perubahan UI wajib diawali pemeriksaan dampak API. Jika UI membutuhkan
  data, field, filter, permission, error code, state transition, atau perilaku
  backend baru/berubah, pekerjaan tersebut dianggap sebagai perubahan kontrak
  lintas frontend-backend.
- Untuk perubahan kontrak yang dipicu UI, perbarui
  `/Users/muhnasrul/Documents/Project-PKP/prototype/docs/openapi-v1.yaml` sebagai
  kontrak normatif dan
  `/Users/muhnasrul/Documents/Project-PKP/prototype/docs/api-contract-v1.md`
  sebagai penjelasan perilaku dalam perubahan yang sama, sebelum frontend
  bergantung pada kemampuan tersebut.
- Setelah kontrak berubah, regenerate client/type frontend, selaraskan mock dan
  contract test frontend, lalu koordinasikan handler serta contract test backend
  dengan Claude. Jangan menambahkan workaround frontend untuk kontrak yang belum
  disepakati atau belum didokumentasikan.
- Perubahan UI yang murni presentasi dan tidak mengubah kebutuhan backend tidak
  memerlukan perubahan kontrak. Jika perubahan bersifat breaking atau aturan
  bisnisnya ambigu, tetap minta persetujuan manusia sebelum mengubah kontrak.
- Generate type/client dari OpenAPI; jangan menulis ulang DTO response dengan interface manual.
- Mock MSW harus memakai type generated yang sama dengan production client.
- Perubahan endpoint dimulai dari usulan perubahan OpenAPI dan disepakati bersama backend, baru frontend/backend diubah paralel.
- Jangan bergantung pada field undocumented.
- Semua list besar mengikuti cursor pagination dan stable ordering dari API. Jangan mengemulasikan full-history pagination di browser.
- Single-row edit mengirim `rowVersion`; tangani `409 ROW_VERSION_CONFLICT` dengan dialog perbandingan data lokal dan versi server. Jangan overwrite diam-diam.
- Bulk mutation mengirim `Idempotency-Key`. Retry harus menggunakan key dan payload yang sama.
- Tangani error melalui `code` terstruktur, bukan parsing `message`.
- Optimistic update hanya boleh dilakukan jika rollback jelas. Untuk generate, lock, import, dan operasi job berat, tampilkan status server/queue; jangan memalsukan status sukses.
- Jangan memasukkan secret, service credential, atau token internal HRIS ke bundle, local storage, fixture, maupun `.env` yang ter-commit.

## UI/UX dan Design System

Tujuan visual adalah alat kerja administrasi yang padat, tenang, jelas, dan cepat—bukan landing page atau dashboard generik.

- Pertahankan information density seperti spreadsheet, tetapi gunakan hierarchy, spacing, dan affordance yang konsisten.
- Hindari estetika AI generik: gradient dekoratif, kartu besar yang tidak perlu, warna ungu default, shadow berat, excessive rounding, dan whitespace yang mengurangi jumlah data terlihat.
- Gunakan semantic design tokens untuk warna, spacing, typography, border, focus ring, dan state. Jangan menyebar raw hex atau arbitrary pixel values.
- Label, helper text, error, dialog konfirmasi, dan toast harus berbahasa Indonesia yang ringkas dan spesifik.
- Jangan mengandalkan warna saja untuk status atau error. Sertakan teks/icon yang memiliki accessible name.
- Semua aksi harus mempunyai state disabled/loading yang mencegah submit ganda tanpa menghilangkan konteks pengguna.
- Pertahankan draft saat error jaringan; jangan hilangkan hasil edit atau paste admin.
- Sediakan feedback yang jelas untuk valid row, invalid row, unsaved change, saving, saved, conflict, dan locked data.
- Dialog destruktif harus menyebut objek dan dampaknya. Jangan memakai konfirmasi generik seperti “Apakah Anda yakin?”.
- Desktop adalah target utama grid operasional. Pada viewport sempit, kontrol tidak boleh rusak; gunakan layout adaptif dan horizontal overflow yang disengaja tanpa memaksa seluruh grid menjadi kartu.

### Aksesibilitas

- Target WCAG 2.2 AA untuk UI yang berada dalam kendali aplikasi.
- Semua kontrol menggunakan elemen HTML semantik dan dapat dipakai penuh dengan keyboard.
- Focus ring terlihat; jangan menghapus outline tanpa pengganti yang setara.
- Dialog memindahkan dan menjebak fokus dengan benar, lalu mengembalikannya ke pemicu ketika ditutup.
- Form memiliki label dan pesan error yang terhubung secara programatis.
- Perubahan status async penting diumumkan dengan live region tanpa membuat screen reader berisik.
- Hormati `prefers-reduced-motion`.
- Uji zoom 200%, kontras, keyboard-only, dan minimal satu alur dengan screen reader atau accessibility tree.
- Untuk bagian canvas/grid milik Univer, uji keyboard behavior yang benar-benar tersedia dan sediakan kontrol HTML alternatif untuk aksi penting yang tidak aksesibel dari canvas.

## Manual Data: Interaksi Wajib

Grid Manual Data minimal memiliki kolom:

```text
select | shiftStart | shiftEnd | station | assignee | widthCm | weftDensity | resultM
```

- Checkbox pada setiap baris dan checkbox header untuk seleksi batch yang cakupannya jelas.
- Inline edit dengan keyboard yang konsisten: panah untuk navigasi, Enter untuk edit/commit, Escape untuk membatalkan, Tab/Shift+Tab untuk berpindah.
- Copy/paste TSV satu sel, satu baris, rentang persegi, dan banyak baris.
- Paste harus dipreview/divalidasi sebelum commit jika ada kegagalan sebagian. Tampilkan nomor baris, kolom, nilai, dan alasan error.
- Jangan diam-diam memangkas baris atau kolom dari clipboard.
- Assignee menampilkan nama. Saat diedit, buka combobox searchable berisi nama + PIN untuk membedakan nama kembar; nilai tersimpan tetap PIN.
- Pencarian assignee memakai request yang dapat dibatalkan/debounce dan tidak memuat seluruh direktori karyawan ke browser.
- Preserve seleksi, posisi scroll, active cell, dan draft selama refetch yang tidak relevan.
- Edit data terkunci, tidak berizin, atau konflik harus ditolak dengan penjelasan yang dapat ditindaklanjuti.
- Undo/redo lokal tidak boleh memberi kesan bahwa mutation server sudah dibatalkan. Definisikan dengan jelas batas antara draft dan data tersimpan.
- Jangan membuat ulang fitur grid inti yang sudah stabil di Univer tanpa alasan terukur.

## Performa adalah Requirement, Bukan Polesan Akhir

Data produksi akan sangat besar. Terapkan aturan berikut sejak desain pertama:

- Jangan pernah mengambil seluruh histori Manual Data, Detail, LDMS, atau Summary ke browser.
- Gunakan cursor pagination, filter server-side, sorting server-side, dan projection field sesuai kebutuhan layar.
- Render hanya viewport aktif dengan virtualization/windowing. Jangan membuat satu DOM node React per seluruh row dataset.
- Jangan menduplikasi seluruh model grid ke React state. Biarkan engine grid mengelola cell model; React menyimpan state UI/orchestration minimal.
- Lazy-load route dan dependency berat. Bundle Univer hanya boleh dimuat ketika route yang membutuhkannya dibuka.
- Batch save hasil edit/paste. Jangan mengirim satu HTTP request per cell atau per row jika API menyediakan operasi bulk.
- Validasi paste besar secara linear dan chunk pekerjaan CPU bila profiling menunjukkan main thread terblokir. Pertimbangkan Web Worker untuk parsing besar setelah diukur.
- Abort request usang pada search/filter/navigation. Hindari request waterfall dan refetch massal setelah mutation kecil.
- Update cache secara terarah berdasarkan id/key; jangan invalidate semua query tanpa kebutuhan.
- Gunakan stable row ID dari backend, bukan index visual.
- Jangan me-render object payload besar ke log/console di production.
- Hindari object/function allocation per cell pada hot path. Optimalkan renderer cell hanya berdasarkan hasil profiler.
- Ukur sebelum dan sesudah optimasi dengan React Profiler dan browser Performance panel.

Target minimum:

- Core Web Vitals pada kondisi representatif: LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1.
- Tidak ada long task > 50 ms secara berulang saat scroll, select, edit, dan paste pada dataset uji representatif.
- Scroll grid stabil tanpa pertumbuhan DOM seiring total jumlah record.
- Route non-grid tidak menanggung biaya download/parse Univer.
- Bulk paste dan save memiliki progress/feedback, dapat dibatalkan sebelum commit bila masih di tahap draft, dan tidak membuat halaman membeku.

Jika target gagal, lampirkan baseline, trace/bukti bottleneck, perubahan, dan hasil pengukuran ulang. Jangan menambahkan memoization atau cache tanpa bukti.

## Testing dan Quality Gates

Setiap perubahan behavior harus mencakup test pada level termurah yang memberi keyakinan cukup:

- Unit: formatter, parser clipboard, validation, decimal/date adapter, query key, dan reducer/draft logic.
- Component: keyboard navigation, assignee combobox, row checkbox, error/loading/empty/conflict states.
- Contract: generated client dan MSW fixture valid terhadap OpenAPI.
- E2E: paste banyak baris -> validasi -> save; inline edit -> conflict; search assignee; pagination/filter; generate/lock bila fitur tersedia.
- Accessibility: automated axe ditambah keyboard test manual pada alur utama.
- Performance: scenario data representatif untuk scroll, multi-select, paste besar, dan refetch.

Sebelum menyatakan tugas selesai:

1. Jalankan typecheck.
2. Jalankan lint tanpa menonaktifkan rule untuk meloloskan perubahan.
3. Jalankan test yang relevan, lalu full unit suite jika praktis.
4. Jalankan production build.
5. Buka aplikasi di browser nyata; periksa console dan failed network request.
6. Uji viewport 320, 768, 1024, dan 1440 px. Grid operasional terutama diverifikasi pada 1024 dan 1440 px.
7. Uji keyboard-only, loading, empty, error, permission, conflict, dan success state yang tersentuh.
8. Untuk perubahan hot path, simpan hasil profiling sebelum/sesudah.

Perintah konkret mengikuti `package.json`; jangan mengarang nama script. Bila proyek baru belum memiliki script, sediakan minimal `dev`, `build`, `typecheck`, `lint`, `test`, dan `test:e2e`.

## Workflow Agen

1. Baca file yang akan diubah, test terkait, satu contoh pola serupa, dan bagian spec/OpenAPI yang relevan.
2. Tulis rencana singkat dan kriteria selesai sebelum coding.
3. Verifikasi API library yang dapat berubah melalui MCP dokumentasi resmi.
4. Implementasikan perubahan terkecil yang menyelesaikan kebutuhan.
5. Tambahkan atau perbarui test bersamaan dengan behavior.
6. Verifikasi di browser nyata dan ukur performa bila menyentuh hot path.
7. Review diff untuk aksesibilitas, keamanan, kontrak API, data besar, dan accidental complexity.
8. Laporkan hasil, test yang dijalankan, asumsi, dan risiko tersisa secara jujur.

Jaga scope. Jangan melakukan refactor besar, mengganti library, atau mengubah design system saat tugas hanya meminta perubahan kecil. Jangan menutup pekerjaan dengan “seharusnya berjalan”; buktikan melalui test dan browser.

## Larangan Keras

- Jangan memakai `employeeId`; gunakan `pin` saja.
- Jangan fetch seluruh dataset untuk kemudian difilter/paginate di client.
- Jangan memakai index array sebagai identity row.
- Jangan menghitung uang dengan floating point.
- Jangan menyembunyikan API conflict atau menimpa data server diam-diam.
- Jangan mengedit file generated secara manual.
- Jangan hardcode response mock yang menyimpang dari OpenAPI.
- Jangan simpan token sensitif di local storage kecuali arsitektur auth secara eksplisit mensyaratkannya dan telah direview keamanan.
- Jangan menambahkan `eslint-disable`, `@ts-ignore`, `any`, atau cast berbahaya hanya untuk membuat build hijau.
- Jangan mengorbankan keyboard/accessibility untuk mengejar kemiripan visual dengan spreadsheet.
- Jangan mengklaim performa baik tanpa pengukuran pada data representatif.
- Jangan mengubah backend atau kontrak lintas tim tanpa koordinasi dan approval.
- Jangan membaca folder node_modules
