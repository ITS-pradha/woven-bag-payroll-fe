# Manual Data — backend conformance handoff

Frontend mengikuti `prototype/docs/openapi-v1.yaml`. Keputusan pemilik produk pada
2026-09-11: backend diselaraskan ke OpenAPI, bukan frontend yang mengikuti response
backend sementara.

## Endpoint yang dipakai

- `GET /production-entries`: cursor pagination maksimal 500 baris dan wajib
  mengembalikan `ProductionEntryListResponse`, termasuk `createdAt`, `updatedAt`,
  serta `sourceRevision`.
- `GET /production-entries/{productionEntryId}`: diperlukan untuk perbandingan
  draft lokal terhadap versi server saat terjadi konflik.
- `POST /production-entry-batches`: `Idempotency-Key` dan `X-CSRF-Token` wajib.
  Setiap row mengirim `expectedRowVersion` untuk update dan response memakai
  `outcome` + `fieldErrors` sesuai `ProductionEntryBatchResult`.
- `GET /employees` dan `GET /employees/{pin}`: hanya data aktif untuk pemilih
  assignee. Identitas yang disimpan tetap `pin`; nama hanya label UI.

## Perbedaan backend yang perlu diperbaiki

1. Batch backend saat ini membuang `expectedRowVersion`; akibatnya update berisiko
   menimpa perubahan admin lain. Wajib cek versi secara atomik untuk setiap row.
2. Batch response backend memakai `status` / `errors`; OpenAPI memakai `outcome` /
   `fieldErrors` dan menyertakan `sourceRevision`.
3. Response list belum konsisten menyertakan `createdAt`, `updatedAt`, dan
   `sourceRevision`.
4. Endpoint detail `GET /production-entries/{id}` belum tersedia.
5. PATCH backend memakai `rowVersion`; OpenAPI memakai `expectedRowVersion` dan
   mengizinkan koreksi seluruh field produksi. Mutasi wajib menolak versi stale
   dengan `409 ROW_VERSION_CONFLICT`.
6. Void wajib menerima `expectedRowVersion` dan mengikuti response/error OpenAPI.
7. Cursor ordering dan cursor predicate harus memakai tuple yang sama agar tidak
   ada baris terlewat/berulang di antara halaman.
8. Replay `Idempotency-Key` yang sama harus mengembalikan hasil pertama yang
   tersimpan. Key sama dengan payload berbeda harus ditolak.

Frontend memvalidasi response runtime dan tidak menerapkan response yang berbeda
dari OpenAPI. Ini disengaja agar contract drift terlihat, bukan ditutup dengan
adapter diam-diam.
