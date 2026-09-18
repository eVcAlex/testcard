/**
 * A provider category name made readable for a row heading: the "EN - " / "|EN| " / "UK| " prefix
 * dropped and SHOUTING turned into Title Case. Display only; the stored name is never changed.
 */
const PREFIX = /^\s*\|?[A-Za-z]{2}\|?\s*(?:[-:|]\s*|\|\s*)/;

export function categoryLabel(rawName: string): string {
  const stripped = rawName.replace(PREFIX, "").replace(/\s+/g, " ").trim();
  const text = stripped === "" ? rawName.trim() : stripped;
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3 || letters !== letters.toUpperCase()) return text;
  return text.toLowerCase().replace(/(^|[\s(/&+-])([a-z])/g, (_match, lead: string, letter: string) => lead + letter.toUpperCase());
}
