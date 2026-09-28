/**
 * Which of a source's channels each channel in a TV guide (XMLTV) is for.
 *
 * By id first: the guide's channel id against the `tvg-id` the provider gave the channel, exactly and then ignoring
 * case. Every channel carrying that id gets the listings (a provider's "BBC One HD" and "BBC One FHD" usually share
 * one), not just one of them. A channel no id matches is then matched by name against the guide's display names,
 * tidied the same way on both sides ("UK: BBC One FHD" and "BBC One" meet as "bbcone"), as TiviMate does. That is what
 * makes a guide from somewhere other than the provider (a curated one, set on the source) fill in: its ids are its
 * own, and seldom the provider's.
 */

export interface GuideChannel {
  readonly id: string;
  readonly tvgId: string | null;
  /** The names the channel goes by here: the tidied one shown, and the provider's own. */
  readonly names: readonly string[];
}

export interface XmltvChannel {
  readonly id: string;
  readonly displayNames: readonly string[];
}

/** Guide channel id to the ids of the channels here it is for. */
export type GuideChannelMap = ReadonlyMap<string, readonly string[]>;

/** Words that say how a channel is sent, not which channel it is. */
const NOISE = new Set(["hd", "fhd", "uhd", "sd", "4k", "8k", "hevc", "h264", "h265", "1080p", "1080i", "720p", "50fps", "60fps", "hdr", "raw", "backup", "vip", "multi", "audio", "tv"]);

/**
 * A channel name reduced to what identifies it: lower case, with a leading country or group tag ("UK:", "UK |",
 * "[UK]"), anything in brackets and the quality words gone, and no spaces or punctuation. "+1" stays: a
 * timeshift channel is a channel of its own. Empty when nothing is left.
 */
export function guideNameKey(name: string): string {
  let text = name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  // Group tags before the name: "UK: ", "UK | ", "|UK| ", "UK - ".
  text = text.replace(/^\W*[a-z]{2,4}\W*[:|]\W*/, "").replace(/^\W*[a-z]{2}\s+-\s+/, "");
  text = text.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/&/g, " and ");
  const words = text
    .split(/[^a-z0-9+]+/)
    .filter((word) => word !== "" && !NOISE.has(word));
  return words.join("");
}

/**
 * Builds the map from the guide's channel list. With no channel list (a guide may leave it out), only ids can match,
 * so every `tvg-id` here maps to itself.
 */
export function matchGuideChannels(channels: readonly GuideChannel[], guide: readonly XmltvChannel[]): GuideChannelMap {
  const out = new Map<string, string[]>();
  const add = (guideId: string, channelId: string) => {
    const list = out.get(guideId);
    if (list === undefined) out.set(guideId, [channelId]);
    else if (!list.includes(channelId)) list.push(channelId);
  };

  const guideIds = new Set(guide.map((entry) => entry.id));
  const guideIdsLower = new Map<string, string>();
  for (const entry of guide) if (!guideIdsLower.has(entry.id.toLowerCase())) guideIdsLower.set(entry.id.toLowerCase(), entry.id);
  const byName = new Map<string, string>();
  for (const entry of guide) {
    for (const name of [...entry.displayNames, entry.id]) {
      const key = guideNameKey(name);
      if (key !== "" && !byName.has(key)) byName.set(key, entry.id);
    }
  }

  for (const channel of channels) {
    const tvg = channel.tvgId?.trim() ?? "";
    if (tvg !== "") {
      // No channel list to check against: the listings' own channel attribute is all there is to go on.
      if (guide.length === 0 || guideIds.has(tvg)) {
        add(tvg, channel.id);
        continue;
      }
      const loose = guideIdsLower.get(tvg.toLowerCase());
      if (loose !== undefined) {
        add(loose, channel.id);
        continue;
      }
    }
    for (const name of channel.names) {
      const guideId = byName.get(guideNameKey(name));
      if (guideId !== undefined) {
        add(guideId, channel.id);
        break;
      }
    }
  }
  return out;
}
