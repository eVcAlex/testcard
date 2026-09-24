/**
 * A provider category name made readable for a row heading: the "EN - " / "|EN| " / "UK| " prefix
 * dropped, the provider's own tag in superscript letters ("TNT Sports ᴳᴬᴺᴶᴬ") dropped, and SHOUTING
 * turned into Title Case. Display only; the stored name is never changed.
 *
 * Takes the raw name. Superscript runs that say something about quality ("⁴ᴷ", "ᵁᴴᴰ", "³⁸⁴⁰ᴾ") are kept,
 * as ordinary letters (NFKC), since they tell two otherwise identical categories apart; any other run is
 * a provider's branding and goes.
 */
const PREFIX = /^\s*\|?[A-Za-z]{2}\|?\s*(?:[-:|]\s*|\|\s*)/;

/** Superscript and small-capital letters and digits, the way providers write their tags. */
const STYLED_RUN = /[ᴀ-ᵿᶀ-ᶿ⁰-₟ⱽ]+(?:\s+[ᴀ-ᵿᶀ-ᶿ⁰-₟ⱽ]+)*/gu;
const QUALITY = /^(?:\d*K|UHD|FHD|HDR\d*|HD|SD|\d{3,4}P\d{0,3}|\d{2,3}FPS|HEVC|H265|4K)(?:\s+(?:\d*K|UHD|FHD|HDR\d*|HD|SD|\d{3,4}P\d{0,3}|\d{2,3}FPS|HEVC|H265))*$/i;

function dropBrandTags(name: string): string {
  return name.replace(STYLED_RUN, (run) => {
    const plain = run.normalize("NFKC");
    return QUALITY.test(plain.trim()) ? plain : "";
  });
}

export function categoryLabel(rawName: string): string {
  const cleaned = dropBrandTags(rawName).normalize("NFKC");
  const stripped = cleaned.replace(PREFIX, "").replace(/\s+/g, " ").trim();
  const text = stripped === "" ? rawName.normalize("NFKC").trim() : stripped;
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3 || letters !== letters.toUpperCase()) return text;
  return text.toLowerCase().replace(/(^|[\s(/&+-])([a-z])/g, (_match, lead: string, letter: string) => lead + letter.toUpperCase());
}
