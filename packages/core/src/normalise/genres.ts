/**
 * How the advisory category genre from classifyCategory is shown. Kept as plain
 * data (and a string-keyed map, not an import of core's `Genre` type) so the renderer never pulls a
 * value from the core barrel — see MoviesView.tsx on why that crashes.
 */
export const GENRE_LABELS: Readonly<Record<string, string>> = {
  sports: "Sports",
  kids: "Kids & family",
  news: "News",
  documentary: "Documentary",
  music: "Music",
  reality: "Reality & lifestyle",
  comedy: "Comedy",
  drama: "Drama",
  action: "Action & adventure",
  horror: "Horror & thriller",
  scifi: "Sci-fi & fantasy",
  romance: "Romance",
  animation: "Animation & anime",
  holiday: "Holiday",
};

/** Adult categories stay browsable by their own name but are never promoted to a top-level filter. */
export interface GenreOption {
  readonly genre: string;
  readonly label: string;
  readonly count: number;
}

/**
 * The genres actually present in a list of categories, biggest first, with how many items each
 * holds. Empty (so the filter row is hidden) unless there are at least two — one genre is no filter.
 */
export function genreOptions(categories: readonly { genre: string | null; count: number }[]): GenreOption[] {
  const totals = new Map<string, number>();
  for (const category of categories) {
    if (category.genre === null || GENRE_LABELS[category.genre] === undefined) continue;
    totals.set(category.genre, (totals.get(category.genre) ?? 0) + category.count);
  }
  const options = [...totals].map(([genre, count]) => ({ genre, label: GENRE_LABELS[genre] as string, count }));
  options.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return options.length >= 2 ? options : [];
}
