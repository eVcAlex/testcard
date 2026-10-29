import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SourceListItem } from "../../../shared/ipc.js";

/**
 * "Share a setup link" for one source. The link is a bearer credential - anyone holding it can add the source until it is used,
 * expires or is withdrawn - so it is said plainly here, and it defaults to one use for a week.
 */
export function ShareDialog({ source, onClose }: { source: SourceListItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: () => window.testcard.share.create(source.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["shared-links"] }),
  });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="pw-confirm-backdrop" onClick={onClose} onKeyDown={(event) => event.key === "Escape" && onClose()}>
      <div className="pw-confirm pw-confirm--wide" role="dialog" aria-modal="true" aria-label={`Share ${source.name}`} onClick={(event) => event.stopPropagation()}>
        <h3>Share "{source.name}"</h3>
        {create.data === undefined ? (
          <>
            <p>
              Make a link that sets this source up on someone else's Testcard. It works once and expires in 7 days, and you can withdraw it any time
              from Shared links. It doesn't give them access to your Testcard account.
            </p>
            <p>Only share a login with people your provider allows. Many providers limit how many devices can watch at once.</p>
            {create.isError && <p className="msg msg--error">{(create.error as Error).message}</p>}
            <div className="pw-confirm-actions">
              <button type="button" className="btn btn--ghost" autoFocus onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn--primary" disabled={create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? "Making link…" : "Make link"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>Send this to them. Anyone who has it can add this source until it's used or expires on {new Date(create.data.expiresAt).toLocaleDateString()}.</p>
            <label className="field">
              <span>Setup link</span>
              <input className="input" readOnly value={create.data.url} onFocus={(event) => event.currentTarget.select()} />
            </label>
            <div className="pw-confirm-actions">
              <button type="button" className="btn btn--ghost" onClick={onClose}>Done</button>
              <button type="button" className="btn btn--primary" onClick={() => void copy(create.data.url)}>{copied ? "Copied" : "Copy link"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
