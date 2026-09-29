import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { createQueryClient } from "../app/query-client";
import { sessionQueryKey } from "../features/auth/api/session-query";
import { Component as DetailRoute } from "./detail.route";
import { Component as ManualDataRoute } from "./manual-data.route";
import { Component as RatesRoute } from "./rates.route";
import { Component as SummaryRoute } from "./summary.route";

vi.mock("../features/manual-data/components/manual-data-page", () => ({
  ManualDataPage: (props: {
    canWrite: boolean;
    canCreateBook: boolean;
    canCloseBook: boolean;
  }) => (
    <output data-testid="manual-write">
      {String(props.canWrite && props.canCreateBook && props.canCloseBook)}
    </output>
  ),
}));
vi.mock("../features/rates/components/rates-page", () => ({
  RatesPage: (props: {
    canRead: boolean;
    canWrite: boolean;
    canApprove: boolean;
  }) => (
    <output data-testid="rates-access">
      {String(props.canRead && props.canWrite && props.canApprove)}
    </output>
  ),
}));
vi.mock("../features/summary/components/summary-page", () => ({
  SummaryPage: (props: {
    canRead: boolean;
    canGenerate: boolean;
    canOverride: boolean;
    canReview: boolean;
    canLock: boolean;
    canReadRates: boolean;
  }) => (
    <output data-testid="summary-access">
      {String(
        props.canRead &&
          props.canGenerate &&
          props.canOverride &&
          props.canReview &&
          props.canLock &&
          props.canReadRates,
      )}
    </output>
  ),
}));
vi.mock("../features/detail/components/detail-page", () => ({
  DetailPage: ({ canRead }: { canRead: boolean }) => (
    <output data-testid="detail-read">{String(canRead)}</output>
  ),
}));

it("menampilkan seluruh kapabilitas UI kepada superadmin tanpa permission eksplisit", () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(sessionQueryKey, {
    user: {
      userId: "d890801f-4a1c-4fc1-a03d-187faaf4f75a",
      hrisUserId: 42,
      email: "1027",
      displayName: "Super Admin",
    },
    permissions: [],
    roles: ["SUPER_ADMIN"],
    isSuperAdmin: true,
    expiresAt: "2026-09-24T02:11:40.000Z",
    csrfToken: "csrf-test",
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ManualDataRoute />
      <RatesRoute />
      <SummaryRoute />
      <DetailRoute />
    </QueryClientProvider>,
  );

  expect(screen.getByTestId("manual-write")).toHaveTextContent("true");
  expect(screen.getByTestId("rates-access")).toHaveTextContent("true");
  expect(screen.getByTestId("summary-access")).toHaveTextContent("true");
  expect(screen.getByTestId("detail-read")).toHaveTextContent("true");
});
