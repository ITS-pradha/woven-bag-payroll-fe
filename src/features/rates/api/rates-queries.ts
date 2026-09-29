import { queryOptions } from "@tanstack/react-query";

import { getRateVersion, listRateVersions } from "./rates-api";
import { getRateCalculationPolicy } from "./calculation-policy-api";
import {
  getStationGroupVersion,
  listStationGroupVersions,
} from "./station-group-api";

export const rateVersionsQueryKey = ["pay-rate-versions"] as const;

export function rateVersionsQueryOptions() {
  return queryOptions({
    queryKey: rateVersionsQueryKey,
    queryFn: ({ signal }) => listRateVersions(signal),
  });
}

export function rateVersionQueryOptions(rateVersionId: string) {
  return queryOptions({
    queryKey: [...rateVersionsQueryKey, rateVersionId],
    queryFn: ({ signal }) => getRateVersion(rateVersionId, signal),
    enabled: Boolean(rateVersionId),
  });
}

export function rateCalculationPolicyQueryOptions(rateVersionId: string) {
  return queryOptions({
    queryKey: [...rateVersionsQueryKey, rateVersionId, "calculation-policy"],
    queryFn: ({ signal }) => getRateCalculationPolicy(rateVersionId, signal),
    enabled: Boolean(rateVersionId),
  });
}

export const stationGroupVersionsQueryKey = ["station-group-versions"] as const;

export function stationGroupVersionQueryOptions(id: string) {
  return queryOptions({
    queryKey: [...stationGroupVersionsQueryKey, id],
    queryFn: ({ signal }) => getStationGroupVersion(id, signal),
    enabled: Boolean(id),
  });
}

export function stationGroupVersionsQueryOptions() {
  return queryOptions({
    queryKey: stationGroupVersionsQueryKey,
    queryFn: ({ signal }) => listStationGroupVersions(signal),
  });
}
