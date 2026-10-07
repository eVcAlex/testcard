export const CONTACT_EMAIL = "hello@evicted.dev";

/** Made from invented demo content (scripts/screenshots). Files live in apps/web/public/shots/. Empty hides the section. */
export const SHOTS: readonly { src: string; alt: string; caption: string; width: number; height: number }[] = [
  { src: "/shots/tv-home.webp", alt: "The Testcard Home screen on a Fire TV, showing a numbered Top 10 movies row of poster tiles.", caption: "Home on Fire TV: what is new and what is popular in your library.", width: 1600, height: 900 },
  { src: "/shots/tv-guide.webp", alt: "The Testcard TV guide on a Fire TV: a timeline of programmes for fourteen channels, with the current programme highlighted.", caption: "The TV guide on Fire TV, with what is on now across your channels.", width: 1600, height: 900 },
  { src: "/shots/desktop-live.webp", alt: "The Testcard desktop app on Live TV: a category list, a channel preview and a programme guide grid.", caption: "Live TV on Windows, with the guide beside the channel list.", width: 1600, height: 900 },
  { src: "/shots/desktop-movies.webp", alt: "The Testcard desktop app on Movies: poster shelves grouped by category with titles and years.", caption: "Movies on Windows, browsed by category.", width: 1600, height: 900 },
];
