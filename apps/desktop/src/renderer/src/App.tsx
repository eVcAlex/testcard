import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RefreshResult } from "../../shared/ipc.js";
import { AddSourceForm } from "./AddSourceForm.js";

/**
 * Deliberately minimal for now: proves the full renderer -> preload -> main -> @testcard/core
 * -> SQLite round trip (add a source, refresh it, see counts) end to end. The real sidebar
 * + channel grid (plan step 6) is a separate, much larger pass once playback (step 5) exists
 * to click through to.
 */
export function App() {
  const queryClient = useQueryClient();
  const sourcesQuery = useQuery({
    queryKey: ["sources"],
    queryFn: () => window.testcard.sources.list(),
  });
  const [lastRefresh, setLastRefresh] = useState<RefreshResult | null>(null);

  const refreshMutation = useMutation({
    mutationFn: (sourceId: string) => window.testcard.sources.refresh(sourceId),
    onSuccess: (result) => setLastRefresh(result),
  });

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <aside
        style={{
          width: 280,
          borderRight: "1px solid var(--border)",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <h1 style={{ fontSize: 16, margin: 0, letterSpacing: 0.5 }}>Testcard</h1>

        <section>
          <h2 style={{ fontSize: 12, textTransform: "uppercase", color: "var(--text-muted)", margin: "0 0 8px" }}>
            Sources
          </h2>
          {sourcesQuery.isLoading && <p style={{ color: "var(--text-muted)" }}>Loading…</p>}
          {sourcesQuery.data?.length === 0 && (
            <p style={{ color: "var(--text-muted)" }}>No source configured yet.</p>
          )}
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {sourcesQuery.data?.map((source) => (
              <li
                key={source.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "var(--bg-raised)",
                }}
              >
                <span>{source.name}</span>
                <button
                  onClick={() => refreshMutation.mutate(source.id)}
                  disabled={refreshMutation.isPending}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    padding: "4px 8px",
                    cursor: "pointer",
                  }}
                >
                  {refreshMutation.isPending ? "Refreshing…" : "Refresh"}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <AddSourceForm onAdded={() => void queryClient.invalidateQueries({ queryKey: ["sources"] })} />
      </aside>

      <main style={{ flex: 1, padding: 24 }}>
        {lastRefresh && (
          <p style={{ color: "var(--text-muted)" }}>
            Imported {lastRefresh.channels} channels across {lastRefresh.categories} categories (
            {lastRefresh.variants} variants) in {lastRefresh.durationMs}ms.
          </p>
        )}
        {!lastRefresh && <p style={{ color: "var(--text-muted)" }}>Add a source, then Refresh, to import channels.</p>}
      </main>
    </div>
  );
}
