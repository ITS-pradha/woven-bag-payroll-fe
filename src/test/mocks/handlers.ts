import type { RequestHandler } from "msw";
import { detailHandlers } from "../../features/detail/api/detail-mocks";
import { manualDataHandlers } from "../../features/manual-data/api/manual-data-mocks";
import { rateHandlers } from "../../features/rates/api/rates-mocks";
import { advancedRateHandlers } from "../../features/rates/api/advanced-rates-mocks";
import { summaryHandlers } from "../../features/summary/api/summary-mocks";

// Handler ditambahkan per feature dan wajib memakai operationId dari OpenAPI.
export const handlers: RequestHandler[] = [
  ...manualDataHandlers,
  ...rateHandlers,
  ...advancedRateHandlers,
  ...summaryHandlers,
  ...detailHandlers,
];
