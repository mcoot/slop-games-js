/**
 * Facts about the answer, so the robot judges questions against what's written down
 * rather than what its model happens to remember (decision models know little, and
 * nothing after their training). We take the intro of the answer's Wikipedia article.
 */
export interface Facts {
  /** The article's title and link, so the baron can check it read up on the right thing. */
  title: string;
  url: string;
  text: string;
}

export type Lookup = (answer: string, notes: string) => Promise<Facts | null>;

/** Clef reads roughly the first 2K tokens of the state; leave room for the rest. */
const MAX_CHARS = 1500;

interface SearchPage {
  title: string;
  index?: number;
  extract?: string;
  fullurl?: string;
  pageprops?: { disambiguation?: string };
}

/**
 * Search Wikipedia for the answer (with the baron's notes to steer it) and take the best
 * hit's intro as plain text. Null when there's nothing usable; never throws.
 */
export function wikipedia(o: { fetch?: typeof fetch; timeoutMs?: number } = {}): Lookup {
  return async (answer, notes) => {
    try {
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        formatversion: "2",
        generator: "search",
        gsrsearch: `${answer} ${notes}`.trim(),
        gsrlimit: "3",
        prop: "extracts|info|pageprops",
        exintro: "1",
        explaintext: "1",
        inprop: "url",
        redirects: "1",
      });
      const res = await (o.fetch ?? fetch)(`https://en.wikipedia.org/w/api.php?${params}`, {
        // Wikimedia asks API users to say who they are.
        headers: { "user-agent": "slop-games-railway-baron/1.0 (https://slop-games.spearritt.dev/railway-baron/)" },
        signal: AbortSignal.timeout(o.timeoutMs ?? 5000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { query?: { pages?: SearchPage[] } };
      const page = (body.query?.pages ?? [])
        .filter((p) => p.extract?.trim() && p.pageprops?.disambiguation === undefined)
        .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))[0];
      if (!page) return null;
      return { title: page.title, url: page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`, text: trim(page.extract!) };
    } catch {
      return null;
    }
  };
}

/** Cut at a sentence end before the limit. */
function trim(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= MAX_CHARS) return t;
  const cut = t.slice(0, MAX_CHARS);
  const end = cut.lastIndexOf(". ");
  return end > MAX_CHARS / 2 ? cut.slice(0, end + 1) : cut;
}
