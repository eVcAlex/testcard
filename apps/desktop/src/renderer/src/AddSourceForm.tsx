import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";

export function AddSourceForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [pastedUrl, setPastedUrl] = useState("");

  const mutation = useMutation({
    mutationFn: () => window.testcard.sources.add({ name, pastedUrl }),
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
    <form onSubmit={handleSubmit} className="add-source">
      <p className="section-title">Add source</p>
      <input
        className="input"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <input
        className="input"
        placeholder="Paste your M3U or get.php URL"
        value={pastedUrl}
        onChange={(e) => setPastedUrl(e.target.value)}
        required
      />
      <button type="submit" className="btn btn--primary" disabled={mutation.isPending}>
        {mutation.isPending ? "Adding…" : "Add source"}
      </button>
      {mutation.isError && (
        <p className="msg msg--error">{(mutation.error as Error).message}</p>
      )}
    </form>
  );
}
