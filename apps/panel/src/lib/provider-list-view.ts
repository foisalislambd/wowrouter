const KEY = "airoute.providers.view";

export type ProviderListView = {
  q: string
  category: string
  scroll: number
  count: number
};

export function readProviderListView(): ProviderListView {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) || "") as Partial<ProviderListView>;
    return {
      q: typeof parsed.q === "string" ? parsed.q : "",
      category: typeof parsed.category === "string" && parsed.category ? parsed.category : "all",
      scroll: typeof parsed.scroll === "number" && parsed.scroll > 0 ? parsed.scroll : 0,
      count: typeof parsed.count === "number" && parsed.count > 0 ? parsed.count : 0,
    };
  } catch {
    return { q: "", category: "all", scroll: 0, count: 0 };
  }
}

export function writeProviderListView(view: ProviderListView) {
  sessionStorage.setItem(KEY, JSON.stringify(view));
}

export function providersListPath(view = readProviderListView()) {
  const params = new URLSearchParams();
  if (view.q) params.set("q", view.q);
  if (view.category && view.category !== "all") params.set("category", view.category);
  const query = params.toString();
  return query ? `/providers?${query}` : "/providers";
}

const modelKey = (slug: string) => `airoute.provider.${slug}.models`;

export function readModelSearch(slug: string) {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(modelKey(slug)) || "") as { q?: string; scroll?: number };
    return {
      q: typeof parsed.q === "string" ? parsed.q : "",
      scroll: typeof parsed.scroll === "number" && parsed.scroll > 0 ? parsed.scroll : 0,
    };
  } catch {
    return { q: "", scroll: 0 };
  }
}

export function writeModelSearch(slug: string, q: string, scroll: number) {
  sessionStorage.setItem(modelKey(slug), JSON.stringify({ q, scroll }));
}
