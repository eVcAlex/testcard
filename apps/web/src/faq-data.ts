import { PRODUCT_NAME, SIGNED } from "./site.ts";

interface FaqItem {
  id: string;
  question: string;
  /** Paragraphs. `[text](/path#hash)` is an internal link; the same paragraphs, links flattened, feed the JSON-LD. */
  answer: readonly string[];
  /** In the FAQPage JSON-LD? Never legality, pricing or anything that depends on the release or version. */
  structured: boolean;
}

export const GUIDE_QUESTION = "Why is my guide empty or wrong?";

export const FAQ: readonly FaqItem[] = [
  {
    id: "channels",
    question: `Does ${PRODUCT_NAME} come with channels?`,
    answer: [`No. ${PRODUCT_NAME} is a player only. It ships no channels, playlists or streams, and it doesn't recommend providers. You add a source you are entitled to use.`],
    structured: true,
  },
  {
    id: "legal",
    question: "Is using an IPTV player legal?",
    answer: [
      "A player is ordinary software, like a media player or a web browser. What matters is whether you are entitled to the content of the source you add.",
      `That depends on the source and on where you live, and we can't tell you. This is not legal advice. ${PRODUCT_NAME} supplies no sources, so use only ones you have the right to watch.`,
    ],
    structured: false,
  },
  {
    id: "price",
    question: `Is ${PRODUCT_NAME} free?`,
    answer: [`The beta is free. We haven't set what ${PRODUCT_NAME} will cost after the beta, and we'll say so here before anything is charged for. Your source is separate: we don't sell one, and you pay your provider, if it charges, not us.`],
    structured: false,
  },
  {
    id: "sources",
    question: "Which source types work?",
    answer: [`Xtream Codes logins (server, username and password) and M3U playlists (a playlist address), with an optional XMLTV address for the guide. [How to add one](/setup).`],
    structured: true,
  },
  {
    id: "windows-warning",
    question: "Why does Windows warn about the installer?",
    answer: [
      SIGNED
        ? "The Windows installer is code-signed, so SmartScreen should not warn about it. If it does, a new release can take a little while to build reputation: choose More info, then Run anyway."
        : "The Windows installer is not code-signed yet, so Windows SmartScreen shows a warning the first time you run it. Choose More info, then Run anyway.",
      "We publish a SHA-256 next to every build, so you can check the file you downloaded matches.",
    ],
    structured: false,
  },
  {
    id: "fire-tv",
    question: "How do I install it on Fire TV?",
    answer: [
      "Install the free Downloader app on your Fire TV, then use it to fetch the app with a Downloader code. The code is shared with beta testers. You may need to allow Downloader to install apps from unknown sources in the Fire TV settings.",
      "[Join the waitlist](/download#waitlist) and we'll send it when the beta opens.",
    ],
    structured: false,
  },
  {
    id: "phones",
    question: "Does it work on phones?",
    answer: ["Not for now. The apps are for Windows and Fire TV. The Fire TV layout is drawn for a TV and a remote."],
    structured: false,
  },
  {
    id: "sync",
    question: "What gets synced, and is it encrypted?",
    answer: [
      "If you sign in, your account keeps your sources, favourites, recently watched, progress, profiles and hidden items in step across devices.",
      "Provider logins are synced only encrypted with a key derived from your account password, so we can't read them. The flip side is that a forgotten password can't be recovered.",
    ],
    structured: false,
  },
  {
    id: "profiles",
    question: "Can I use several profiles?",
    answer: ["Yes, up to 4 on an account. Each has its own Continue watching, favourites, recently watched and progress."],
    structured: false,
  },
  {
    id: "recording",
    question: "Does it record?",
    answer: ["No."],
    structured: false,
  },
];

/** Why the guide is empty or wrong: concrete causes, in the order to check them. */
export const GUIDE_CAUSES: readonly { id: string; title: string; text: string }[] = [
  {
    id: "no-xmltv",
    title: "There is no XMLTV address.",
    text: `Leave the XMLTV / EPG URL field blank and ${PRODUCT_NAME} looks for one: the provider's xmltv.php for Xtream sources, the url-tvg address in the header of an M3U playlist. If your playlist names none, nothing is found. Paste the guide address your provider gives you into the XMLTV / EPG URL field of the source.`,
  },
  {
    id: "id-mismatch",
    title: "The playlist's channel ids don't match the guide's.",
    text: `A guide programme is matched to a channel by the playlist's tvg-id, which has to equal the channel id in the guide file. Providers sometimes leave tvg-id blank or use ids the guide doesn't have. Those channels show no programmes while others do. This is in the provider's data, so ask the provider for a matching guide address.`,
  },
  {
    id: "time-offset",
    title: "The guide's times are off.",
    text: `If programmes are there but at the wrong time, usually by whole hours, the time zone offset in the guide file is wrong or differs from what the playlist assumes. ${PRODUCT_NAME} can only show the times the guide gives it, so try another guide address from your provider.`,
  },
  {
    id: "needs-refresh",
    title: "It needs a refresh.",
    text: `The guide is read when a source refreshes, in the background after the channels load, so a new source or a changed address shows no guide until it has. Refresh the source and give it a few minutes. A guide address that fails never stops the channels loading, so channels can look fine while the guide is still empty. On Windows, set Auto-refresh to keep it current.`,
  },
];

export const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

export const plain = (text: string) => text.replace(LINK, "$1");

/** Question and answer pairs for the FAQPage JSON-LD: timeless answers only. */
export const faqLdItems = () => [
  ...FAQ.filter((i) => i.structured).map((i) => ({ question: i.question, answer: i.answer.map(plain).join(" ") })),
  { question: GUIDE_QUESTION, answer: GUIDE_CAUSES.map((c, n) => `${n + 1}. ${c.title} ${c.text}`).join(" ") },
];
