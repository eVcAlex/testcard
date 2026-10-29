import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SharedLink } from "../../../shared/ipc.js";

/** What happened to a link, in a word. */
export function linkStatus(link: SharedLink, now: number): string {
  if (link.revokedAt !== null) return "Withdrawn";
  if (link.claims >= link.maxClaims) return "Used";
  if (link.expiresAt <= now) return "Expired";
  return "Waiting";
}

/** The links this person has made, with a way to withdraw each. Withdrawing discards what was stored for it, used or not. */
export function SharedLinksPanel() {
  const queryClient = useQueryClient();
  const links = useQuery({ queryKey: ["shared-links"], queryFn: () => window.testcard.share.list() });
  const revoke = useMutation({
    mutationFn: (id: string) => window.testcard.share.revoke(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["shared-links"] }),
  });

  if (links.isError) return <p className="msg msg--error">{(links.error as Error).message}</p>;
  const list = links.data ?? [];
  if (list.length === 0) return <p className="msg msg--hint">{links.isPending ? "Loading…" : "You haven't made any setup links yet. Use a source's menu to share one."}</p>;

  const now = Date.now();
  return (
    <ul className="pw-src-list">
      {list.map((link) => {
        const status = linkStatus(link, now);
        return (
          <li key={link.id} className="pw-src-card">
            <div className="pw-src-body">
              <span className="pw-src-name">{link.label}</span>
              <small className="pw-src-meta">
                {status} · made {new Date(link.createdAt).toLocaleDateString()} · {status === "Waiting" ? `expires ${new Date(link.expiresAt).toLocaleDateString()}` : `${link.claims} of ${link.maxClaims} used`}
              </small>
            </div>
            {status === "Waiting" || (status === "Used" && link.revokedAt === null) ? (
              <button type="button" className="btn btn--ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(link.id)}>
                Withdraw
              </button>
            ) : null}
          </li>
        );
      })}
      {revoke.isError && <p className="msg msg--error">{(revoke.error as Error).message}</p>}
    </ul>
  );
}
