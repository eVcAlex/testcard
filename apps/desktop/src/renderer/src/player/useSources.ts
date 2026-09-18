import { useQuery } from "@tanstack/react-query";

/** The configured sources. Shares the ["sources"] cache with the sidebar and Account. */
export function useSources() {
  return useQuery({
    queryKey: ["sources"],
    queryFn: () => window.testcard.sources.list(),
  });
}
