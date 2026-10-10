export interface Shot { src: string; alt: string; title: string; tags: string; width: number; height: number }

// Real captures of the apps, made from a demo source (scripts/screenshots): open movies and public-domain films. Files live in apps/web/public/shots/.
export const TV_MOVIES: Shot = { src: "/shots/tv-movies.webp", title: "Films and series on your TV", tags: "Fire TV · Movies · Made for the remote", alt: "The Testcard Movies screen on a Fire TV: a grid of film posters with category names down the left.", width: 1600, height: 900 };
export const TV_GUIDE: Shot = { src: "/shots/tv-guide.webp", title: "A TV guide with now and next", tags: "Fire TV · Guide · Catch-up", alt: "The Testcard TV guide on a Fire TV: a timeline of programmes across several channels, with the current programme highlighted.", width: 1600, height: 900 };
export const DESKTOP_LIVE: Shot = { src: "/shots/desktop-live.webp", title: "Live TV on your computer", tags: "Windows · Channels · Preview · Guide", alt: "The Testcard desktop app on Live TV: a category list, a channel preview and a programme guide grid.", width: 1600, height: 900 };
export const DESKTOP_MOVIES: Shot = { src: "/shots/desktop-movies.webp", title: "Films and series on shelves", tags: "Windows · Films · Series", alt: "The Testcard desktop app on Movies: poster shelves grouped by category with titles and years.", width: 1600, height: 900 };

export const SHOTS: readonly Shot[] = [TV_MOVIES, TV_GUIDE, DESKTOP_LIVE, DESKTOP_MOVIES];
