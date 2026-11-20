// Web search providers used to find a player's public pages. RC calls an
// official search API (it does not scrape search engines). Configure one:
//   Google Programmable Search: GOOGLE_CSE_KEY + GOOGLE_CSE_ID  (100 free searches/day)
//   Brave Search API:           BRAVE_SEARCH_API_KEY             (free tier available)

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface SearchProvider {
  name: string;
  search(query: string): Promise<SearchResult[]>;
}

class GoogleCse implements SearchProvider {
  name = "Google Programmable Search";
  constructor(private key: string, private cx: string, private fetchImpl: typeof fetch) {}
  async search(q: string) {
    const u = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(this.key)}&cx=${encodeURIComponent(this.cx)}&num=10&q=${encodeURIComponent(q)}`;
    const r = await this.fetchImpl(u, { signal: AbortSignal.timeout(15_000) });
    if (r.status === 429) throw new Error("Search limit reached for today; RC will continue tomorrow.");
    if (!r.ok) throw new Error(`Search service error ${r.status}`);
    const j = (await r.json()) as { items?: Array<{ link: string; title: string; snippet?: string }> };
    return (j.items ?? []).map((i) => ({ url: i.link, title: i.title, snippet: i.snippet ?? "" }));
  }
}

class Brave implements SearchProvider {
  name = "Brave Search";
  constructor(private key: string, private fetchImpl: typeof fetch) {}
  async search(q: string) {
    const r = await this.fetchImpl(`https://api.search.brave.com/res/v1/web/search?count=10&q=${encodeURIComponent(q)}`, {
      headers: { Accept: "application/json", "X-Subscription-Token": this.key },
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 429) throw new Error("Search limit reached; RC will continue later.");
    if (!r.ok) throw new Error(`Search service error ${r.status}`);
    const j = (await r.json()) as { web?: { results?: Array<{ url: string; title: string; description?: string }> } };
    return (j.web?.results ?? []).map((i) => ({ url: i.url, title: i.title, snippet: (i.description ?? "").replace(/<[^>]+>/g, "") }));
  }
}

export function getSearchProvider(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): SearchProvider | null {
  if (env.GOOGLE_CSE_KEY && env.GOOGLE_CSE_ID) return new GoogleCse(env.GOOGLE_CSE_KEY, env.GOOGLE_CSE_ID, fetchImpl);
  if (env.BRAVE_SEARCH_API_KEY) return new Brave(env.BRAVE_SEARCH_API_KEY, fetchImpl);
  return null;
}
