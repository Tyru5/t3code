import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { ensureNativeApi } from "../nativeApi";

const SKILLS_CATALOG_STALE_TIME_MS = 15_000;

export const skillsQueryKeys = {
  all: ["skills"] as const,
  catalog: () => ["skills", "catalog"] as const,
};

export function skillsCatalogQueryOptions() {
  return queryOptions({
    queryKey: skillsQueryKeys.catalog(),
    queryFn: async () => ensureNativeApi().server.getSkillsCatalog(),
    staleTime: SKILLS_CATALOG_STALE_TIME_MS,
    refetchOnMount: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  });
}

export function invalidateSkillsCatalogQuery(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: skillsQueryKeys.catalog() });
}
