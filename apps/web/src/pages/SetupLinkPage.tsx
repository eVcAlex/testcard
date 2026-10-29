import { useEffect, useState } from "react";
import { BackChip, Meta } from "../ui/parts.tsx";

/**
 * The same shape `parseSetupFragment` accepts (packages/core/src/sync/setupCrypto.ts): a 22-character id, a dot, a 43-character
 * secret. Kept as a pattern here so this page does not pull the crypto and its schema library into the site.
 */
const FRAGMENT = /^#?([A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})$/;

/**
 * What a setup link opens. It only reads the part after the `#` (which the browser never sends to a server), offers to open the
 * app with it, and says how to get the app. It claims nothing itself: only the app does, after asking the person, so a chat app
 * or scanner previewing the page cannot use the link up.
 */
export function SetupLinkPage() {
  const [fragment, setFragment] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  // Read after mount so the prerendered page and the first client render match.
  useEffect(() => {
    setFragment(FRAGMENT.exec(location.hash)?.[1] ?? null);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (fragment === null) {
    return (
      <section className="page-in wrap">
        <BackChip />
        <h1 className="case-title split" tabIndex={-1}>This link is incomplete</h1>
        <p className="case-lede" data-rise>Part of the link was lost on the way. Ask whoever sent it to send it again, making sure the whole address is copied.</p>
      </section>
    );
  }

  return (
    <section className="page-in wrap">
      <BackChip />
      <h1 className="case-title split" tabIndex={-1}>Someone set Testcard up for you</h1>
      <p className="case-lede" data-rise>Install Testcard, open this link in it, and your channels are added. You don't need to type any server details.</p>
      <Meta items={[["You need", "Testcard on your PC"], ["Takes", "A couple of minutes"], ["Account", "Optional"]]} />
      <ol className="lsteps" data-rise>
        <li>
          <p className="tracked">Step 01</p>
          <p>Get Testcard for Windows if you don't have it yet.</p>
          <p><a className="btn" href="/download">Get Testcard</a></p>
        </li>
        <li>
          <p className="tracked">Step 02</p>
          <p>Open this link in the app. You'll be asked to confirm before anything is added.</p>
          {fragment === undefined ? null : (
            <p><a className="btn" href={`testcard://s#${fragment}`}>Open in Testcard</a></p>
          )}
        </li>
        <li>
          <p className="tracked">Step 03</p>
          <p>Nothing happened? In Testcard open <b>Sources</b>, choose <b>Add from a link</b> and paste this address.</p>
          <p><button type="button" className="btn" onClick={copy}>{copied ? "Copied" : "Copy this link"}</button></p>
        </li>
      </ol>
      <p className="note">
        Using a Fire TV? Add the source on your PC or phone first, signed in to a Testcard account, and it follows you to the TV when you sign in there.
        Creating an account is optional on a PC: without one, the source stays on that computer.
      </p>
      <p className="note">Treat this link like a password: whoever has it can add the source until it's used or expires. Don't post it publicly.</p>
    </section>
  );
}
