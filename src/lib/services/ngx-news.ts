import db from '@/lib/db';
import type { NewsArticle } from '@/lib/types';

// Free Nigerian-press RSS feeds. Nairametrics is the high-volume backbone;
// BusinessDay's markets desk adds index/dividend/results stories but blocks
// generic bots, so it needs a browser-like User-Agent and is treated as a
// best-effort bonus (a failure there never sinks the whole refresh).
interface Feed {
  source: NewsArticle['source'];
  url: string;
  publisher: string;
}

const FEEDS: Feed[] = [
  { source: 'nairametrics', url: 'https://nairametrics.com/category/market-news/feed/', publisher: 'Nairametrics' },
  { source: 'businessday', url: 'https://businessday.ng/markets/feed/', publisher: 'BusinessDay' },
];

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Re-fetch feeds at most this often; between refreshes reads are pure cache hits.
const NEWS_STALENESS_MS = 30 * 60 * 1000;
// Only surface reasonably fresh stories, and bound how many hang off one card.
const NEWS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PER_TICKER = 4;
const REFRESH_KEY = 'ngx_news_last_refresh';

// ---- minimal RSS parsing (no dependency; RSS <item> shape is simple) ----

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#8217;|&#x2019;/g, '’')
    .replace(/&#8216;|&#x2018;/g, '‘')
    .replace(/&#8211;/g, '–')
    .replace(/&#\d+;/g, ' ')
    .trim();
}

interface RssItem {
  title: string;
  link: string;
  publishedIso: string | null;
}

function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/g) ?? [];
  for (const block of blocks) {
    const title = decodeEntities(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const link = decodeEntities(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '');
    const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? '').trim();
    if (!title || !link) continue;
    const t = pub ? Date.parse(pub) : NaN;
    items.push({ title, link, publishedIso: Number.isNaN(t) ? null : new Date(t).toISOString() });
  }
  return items;
}

async function fetchFeed(feed: Feed): Promise<RssItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/rss+xml, application/xml, text/xml' },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[ngx-news] ${feed.source} returned ${res.status}`);
      return [];
    }
    return parseRss(await res.text());
  } catch (err) {
    console.error(`[ngx-news] fetch failed for ${feed.source}:`, err);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ---- cache refresh ----

const upsertItem = db.prepare(
  `INSERT INTO ngx_news (link, source, title, published_at, fetched_at)
   VALUES (?, ?, ?, ?, datetime('now'))
   ON CONFLICT(link) DO UPDATE SET
     title = excluded.title, published_at = excluded.published_at, fetched_at = datetime('now')`
);

function lastRefreshMs(): number {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(REFRESH_KEY) as { value: string } | undefined;
  const t = row ? Date.parse(row.value) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Refresh the feed cache when stale. Best-effort per feed (a dead/blocked source
 * is skipped, not fatal) and only marks the refresh done if at least one item
 * landed, so a total outage retries next call rather than going quiet for 30m.
 */
export async function refreshNgxNews(nowMs: number = Date.now(), force = false): Promise<number> {
  if (!force && nowMs - lastRefreshMs() < NEWS_STALENESS_MS) return 0;

  const perFeed = await Promise.all(
    FEEDS.map(async feed => {
      const items = await fetchFeed(feed);
      return items.map(it => ({ ...it, source: feed.source }));
    })
  );
  const all = perFeed.flat();
  if (all.length === 0) return 0; // leave refresh timestamp untouched → retry next call

  const writeAll = db.transaction((rows: (RssItem & { source: NewsArticle['source'] })[]) => {
    for (const r of rows) upsertItem.run(r.link, r.source, r.title, r.publishedIso);
    // Bound growth: keep the 300 most recent items, drop the rest.
    db.prepare(
      `DELETE FROM ngx_news WHERE link NOT IN (
         SELECT link FROM ngx_news ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT 300
       )`
    ).run();
    db.prepare(
      `INSERT INTO app_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(REFRESH_KEY, new Date(nowMs).toISOString());
  });
  writeAll(all);
  return all.length;
}

// ---- ticker matching ----

// Curated match aliases per NGX ticker. Hand-picked because algorithmic
// name-splitting is unsafe here: "Access" over-matches, and BUA Foods vs BUA
// Cement (and Dangote Cement vs Dangote Refinery/Sugar) collide on a bare
// first word. Each alias is matched case-insensitively on word boundaries.
const TICKER_ALIASES: Record<string, string[]> = {
  'NSENG:MTNN': ['MTN Nigeria', 'MTN'],
  'NSENG:ZENITHBANK': ['Zenith Bank', 'Zenith'],
  'NSENG:ACCESSCORP': ['Access Holdings', 'Access Corp', 'Accesscorp'],
  'NSENG:FCMB': ['FCMB'],
  'NSENG:NESTLE': ['Nestle Nigeria', 'Nestlé Nigeria', 'Nestle', 'Nestlé'],
  'NSENG:BETAGLAS': ['Beta Glass'],
  'NSENG:WAPCO': ['Lafarge Africa', 'Lafarge', 'WAPCO'],
  'NSENG:PRESCO': ['Presco'],
  'NSENG:OKOMUOIL': ['Okomu Oil', 'Okomu'],
  'NSENG:SEPLAT': ['Seplat'],
  'NSENG:UBA': ['United Bank for Africa', 'UBA'],
  'NSENG:BUAFOODS': ['BUA Foods'],
  'NSENG:AIICO': ['AIICO'],
  'NSENG:NEM': ['NEM Insurance'],
  'NSENG:ARADEL': ['Aradel'],
  'NSENG:MECURE': ['MeCure', 'Mecure'],
  'NSENG:BUACEMENT': ['BUA Cement'],
  'NSENG:DANGCEM': ['Dangote Cement', 'Dangcem'],
};

// Generic corporate suffixes to strip when deriving a fallback alias for a
// ticker not in the curated map.
const SUFFIX_RE = /\b(plc|nigeria|group|holdings?|company|industries|international|limited|ltd|nig)\b/gi;

export function aliasesFor(ticker: string, name: string | null): string[] {
  const curated = TICKER_ALIASES[ticker];
  if (curated) return curated;
  const out: string[] = [];
  if (name) {
    const trimmed = name.replace(SUFFIX_RE, '').replace(/\s+/g, ' ').trim();
    if (trimmed.length >= 3) out.push(trimmed);
    if (name.length >= 3) out.push(name);
  }
  const symbol = ticker.replace('NSENG:', '');
  if (symbol.length >= 4) out.push(symbol); // 4+ chars avoids matching common short words
  return [...new Set(out)];
}

export function titleMatches(title: string, aliases: string[]): boolean {
  const hay = title.toLowerCase();
  return aliases.some(a => {
    const needle = a.toLowerCase();
    // word-boundary check without regex-escaping headaches
    const idx = hay.indexOf(needle);
    if (idx === -1) return false;
    const before = idx === 0 ? ' ' : hay[idx - 1];
    const after = idx + needle.length >= hay.length ? ' ' : hay[idx + needle.length];
    return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
  });
}

interface CachedNewsRow {
  link: string;
  source: string;
  title: string;
  published_at: string | null;
  fetched_at: string;
}

/**
 * Matched, recent headlines per ticker (newest first, capped). Reads the cache
 * only — call refreshNgxNews() first if you need it warm.
 */
export function getNgxNewsByTicker(
  tickers: { ticker: string; name: string | null }[],
  nowMs: number = Date.now()
): Map<string, NewsArticle[]> {
  const rows = db.prepare(
    `SELECT link, source, title, published_at, fetched_at FROM ngx_news
     ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT 300`
  ).all() as CachedNewsRow[];

  const cutoff = nowMs - NEWS_MAX_AGE_MS;
  const fresh = rows.filter(r => {
    const t = Date.parse(r.published_at ?? r.fetched_at);
    return Number.isNaN(t) || t >= cutoff;
  });

  const publisherOf = (source: string) =>
    FEEDS.find(f => f.source === source)?.publisher ?? source;

  const out = new Map<string, NewsArticle[]>();
  for (const { ticker, name } of tickers) {
    const aliases = aliasesFor(ticker, name);
    const articles: NewsArticle[] = [];
    for (const r of fresh) {
      if (articles.length >= MAX_PER_TICKER) break;
      if (!titleMatches(r.title, aliases)) continue;
      articles.push({
        source: r.source as NewsArticle['source'],
        title: r.title,
        url: r.link,
        publisher: publisherOf(r.source),
        published_at: r.published_at ?? r.fetched_at,
      });
    }
    out.set(ticker, articles);
  }
  return out;
}
