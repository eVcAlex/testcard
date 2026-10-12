import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PinKind } from "@testcard/core";

/** Rail entries that are not one provider category, so there is nothing to pin. */
export const isPinnable = (id: string): boolean => !["home", "all", "favourites", "recent"].includes(id) && !id.startsWith("all:");

/** The categories of one kind pinned to Home, and a way to pin or unpin one. */
export function usePins(kind: PinKind) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["home", "pins", kind], queryFn: () => window.testcard.home.pinned(kind) });
  const toggle = useMutation({
    mutationFn: ({ categoryId, label }: { categoryId: string; label: string }) => window.testcard.home.togglePin(kind, categoryId, label),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["home"] }),
  });
  return { pinned: new Set(query.data ?? []), toggle: (categoryId: string, label: string) => toggle.mutate({ categoryId, label }) };
}
