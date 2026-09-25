import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** Every profile on the account, and which one's rows are in the tables now. */
export function useProfiles() {
  const list = useQuery({ queryKey: ["profiles"], queryFn: () => window.testcard.profiles.list() });
  const current = useQuery({ queryKey: ["profiles", "current"], queryFn: () => window.testcard.profiles.current() });
  const profiles = list.data ?? [];
  return { profiles, currentId: current.data, currentProfile: profiles.find((profile) => profile.id === current.data) };
}

/**
 * Switches whose favourites, recents and progress are in the tables. A swap touches nearly every
 * personal list at once, so on success everything refetches rather than a chosen few query keys.
 */
export function useSwitchProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => window.testcard.profiles.switchTo(id),
    onSuccess: () => void queryClient.invalidateQueries(),
  });
}
