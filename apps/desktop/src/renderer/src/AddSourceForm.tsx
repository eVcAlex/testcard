import { useState, type CSSProperties, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";

export function AddSourceForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [pastedUrl, setPastedUrl] = useState("");

  const mutation = useMutation({
    mutationFn: () => window.testcard.sources.addXtream({ name, pastedUrl }),
    onSuccess: () => {
      setName("");
      setPastedUrl("");
      onAdded();
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ fontSize: 12, textTransform: "uppercase", color: "var(--text-muted)", margin: 0 }}>
        Add source
      </h2>
      <input
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        style={inputStyle}
      />
      <input
        placeholder="Paste your M3U or get.php URL"
        value={pastedUrl}
        onChange={(e) => setPastedUrl(e.target.value)}
        required
        style={inputStyle}
      />
      <button
        type="submit"
        disabled={mutation.isPending}
        style={{
          background: "var(--accent)",
          border: "none",
          borderRadius: 6,
          color: "#fff",
          padding: "8px 12px",
          cursor: "pointer",
        }}
      >
        {mutation.isPending ? "Checking…" : "Add"}
      </button>
      {mutation.isError && (
        <p style={{ color: "var(--danger)", fontSize: 12, margin: 0 }}>{(mutation.error as Error).message}</p>
      )}
    </form>
  );
}

const inputStyle: CSSProperties = {
  background: "var(--bg-raised)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "8px 10px",
};
