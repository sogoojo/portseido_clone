'use client';

import { useState, useEffect, useMemo } from 'react';
import type { DailySummary, NewsArticle } from '@/lib/types';
import SentimentTrends from '@/components/summaries/SentimentTrends';

type Sentiment = 'negative' | 'neutral' | 'positive' | 'none';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Does this ticker have any forward analyst coverage? (crypto/some ETFs don't)
function hasForwardCoverage(s: DailySummary): boolean {
  return (
    s.recommendation_mean != null ||
    s.target_mean != null ||
    s.earnings_trend.length > 0
  );
}

// Net bullishness of an analyst rating mix, weighted and normalised to [-1, 1].
function netBullish(r: {
  strongBuy: number; buy: number; hold: number; sell: number; strongSell: number;
}): number {
  const total = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell;
  if (!total) return 0;
  return (r.strongBuy * 2 + r.buy - r.sell - r.strongSell * 2) / (total * 2);
}

// Forward-looking sentiment: analyst consensus + 12mo target upside + estimate-
// revision momentum + how the rating mix has shifted over the last ~3 months.
// Deliberately ignores the single-day price move.
function forwardScore(s: DailySummary): number {
  let score = 0;

  // 1. Consensus rating (1=buy .. 5=sell): bullish below 3
  if (s.recommendation_mean != null) {
    score += clamp(3 - s.recommendation_mean, -2, 2);
  }

  // 2. 12-month price-target upside vs current price.
  // Wide cap (±4) so genuinely larger upside ranks above smaller — a 33% upside
  // should beat 22%, not flat-line at the same value.
  if (s.target_mean != null && s.close) {
    const upside = (s.target_mean - s.close) / s.close;
    score += clamp(upside * 10, -4, 4);
  }

  // 3. Estimate-revision momentum (next year): analysts raising vs cutting.
  // Cap ±3 so strong conviction (net +40) outweighs mild (net +9).
  const ny = s.earnings_trend.find(t => t.period === '+1y');
  if (ny && (ny.eps_up_30d != null || ny.eps_down_30d != null)) {
    const net = (ny.eps_up_30d ?? 0) - (ny.eps_down_30d ?? 0);
    score += clamp(net / 8, -3, 3);
  }

  // 4. Rating-mix trajectory: now vs ~3 months ago
  const now = s.recommendation_trend.find(t => t.period === '0m');
  const ago = s.recommendation_trend.find(t => t.period === '-3m');
  if (now && ago) {
    score += clamp((netBullish(now) - netBullish(ago)) * 5, -1, 1);
  }

  return score;
}

function forwardSentiment(s: DailySummary): Sentiment {
  if (!hasForwardCoverage(s)) return 'none';
  const score = forwardScore(s);
  if (score <= -2) return 'negative';
  if (score >= 2) return 'positive';
  return 'neutral';
}

const SENTIMENT_STYLES: Record<Sentiment, { card: string; label: string; text: string }> = {
  negative: {
    card: 'border-red-200 bg-red-50/60',
    label: 'bg-red-100 text-red-700',
    text: 'Bearish',
  },
  neutral: {
    card: 'border-amber-200 bg-amber-50/40',
    label: 'bg-amber-100 text-amber-700',
    text: 'Neutral',
  },
  positive: {
    card: 'border-green-200 bg-green-50/50',
    label: 'bg-green-100 text-green-700',
    text: 'Bullish',
  },
  none: {
    card: 'border-gray-200 bg-white',
    label: 'bg-gray-100 text-gray-500',
    text: 'No coverage',
  },
};

// Sort weight: strongest/best outlook first, worst last; uncovered sink to the bottom.
function sentimentRank(s: Sentiment): number {
  if (s === 'positive') return 0;
  if (s === 'neutral') return 1;
  if (s === 'negative') return 2;
  return 3; // 'none' — no analyst outlook, goes last
}

function formatGrowth(value: number | null): string {
  if (value == null) return '–';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function formatMoney(value: number | null): string {
  if (value == null) return '-';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPct(value: number | null): string {
  if (value == null) return '-';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatVolume(value: number | null): string {
  if (value == null) return '-';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return value.toString();
}

function formatRating(key: string | null): string | null {
  if (!key) return null;
  return key
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const RATING_STYLES: Record<string, string> = {
  strong_buy: 'bg-green-100 text-green-700',
  buy: 'bg-green-50 text-green-700',
  hold: 'bg-amber-100 text-amber-700',
  underperform: 'bg-red-50 text-red-700',
  sell: 'bg-red-100 text-red-700',
};

function NewsItem({ article }: { article: NewsArticle }) {
  return (
    <li className="text-xs">
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:underline"
      >
        {article.title}
      </a>
      <span className="text-gray-400 ml-1">— {article.publisher}</span>
    </li>
  );
}

function SummaryCard({ summary, sentiment }: { summary: DailySummary; sentiment: Sentiment }) {
  const [expanded, setExpanded] = useState(false);
  const isPositive = (summary.change_pct ?? 0) >= 0;
  const styles = SENTIMENT_STYLES[sentiment];

  const rating = formatRating(summary.recommendation_key);
  const ratingStyle = summary.recommendation_key
    ? RATING_STYLES[summary.recommendation_key] ?? 'bg-gray-100 text-gray-600'
    : '';
  const upside =
    summary.target_mean != null && summary.close
      ? (summary.target_mean - summary.close) / summary.close
      : null;
  const hasAnalyst = rating != null || upside != null;

  // Forward earnings outlook: ~3mo (next quarter) and ~12mo (next year)
  const nextQ = summary.earnings_trend.find(t => t.period === '+1q');
  const nextY = summary.earnings_trend.find(t => t.period === '+1y');
  const revNet = nextY ? (nextY.eps_up_30d ?? 0) - (nextY.eps_down_30d ?? 0) : 0;
  const hasOutlook = nextQ?.growth != null || nextY?.growth != null || revNet !== 0;
  const growthColor = (g: number | null) =>
    g == null ? 'text-gray-400' : g >= 0 ? 'text-green-600' : 'text-red-600';

  return (
    <div className={`rounded-lg border p-4 ${styles.card}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">{summary.ticker}</h3>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${styles.label}`}>
            {styles.text}
          </span>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums text-gray-900">
            {formatMoney(summary.close)}
          </p>
          <p className={`text-xs font-medium tabular-nums ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {formatPct(summary.change_pct)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-4 text-xs text-gray-500">
        <span>O: {formatMoney(summary.open)}</span>
        <span>H: {formatMoney(summary.high)}</span>
        <span>L: {formatMoney(summary.low)}</span>
        <span>Vol: {formatVolume(summary.volume)}</span>
      </div>

      {hasAnalyst && (
        <div className="mt-3 flex items-center gap-2 border-t border-gray-200/70 pt-2.5 text-xs">
          {rating && (
            <span className={`font-medium px-1.5 py-0.5 rounded-full ${ratingStyle}`}>
              {rating}
            </span>
          )}
          {upside != null && (
            <span className="text-gray-500">
              <span className={`font-semibold tabular-nums ${upside >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {upside >= 0 ? '+' : ''}{(upside * 100).toFixed(1)}%
              </span>
              {' '}to target {formatMoney(summary.target_mean)}
            </span>
          )}
          {summary.analyst_count != null && (
            <span className="ml-auto text-[10px] text-gray-400">{summary.analyst_count} analysts</span>
          )}
        </div>
      )}

      {hasOutlook && (
        <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-500">
          <span className="text-gray-400">Est. growth</span>
          {nextQ?.growth != null && (
            <span>3mo <b className={`tabular-nums ${growthColor(nextQ.growth)}`}>{formatGrowth(nextQ.growth)}</b></span>
          )}
          {nextY?.growth != null && (
            <span>12mo <b className={`tabular-nums ${growthColor(nextY.growth)}`}>{formatGrowth(nextY.growth)}</b></span>
          )}
          {revNet !== 0 && (
            <span
              className={`ml-auto font-medium ${revNet > 0 ? 'text-green-600' : 'text-red-600'}`}
              title={`${nextY?.eps_up_30d ?? 0} analysts raised, ${nextY?.eps_down_30d ?? 0} cut estimates (30d)`}
            >
              {revNet > 0 ? '↑ est. rising' : '↓ est. falling'}
            </span>
          )}
        </div>
      )}

      {summary.news.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium text-blue-600 hover:text-blue-800"
          >
            {expanded ? 'Hide' : 'Show'} {summary.news.length} article{summary.news.length !== 1 ? 's' : ''}
          </button>
          {expanded && (
            <ul className="mt-2 space-y-1.5">
              {summary.news.map((article, i) => (
                <NewsItem key={i} article={article} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function SummariesPage() {
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [ticker, setTicker] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (ticker) params.set('ticker', ticker);
    if (date) {
      params.set('from', date);
      params.set('to', date);
    } else {
      params.set('latest', 'true');
    }

    fetch(`/api/summaries?${params}`)
      .then(r => r.json())
      .then(json => {
        const data = json.data;
        setSummaries(Array.isArray(data) ? data : data ? [data] : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ticker, date]);

  const scored = useMemo(() => {
    return summaries
      .map(s => ({ summary: s, sentiment: forwardSentiment(s), score: forwardScore(s) }))
      .sort((a, b) => {
        const r = sentimentRank(a.sentiment) - sentimentRank(b.sentiment);
        return r !== 0 ? r : b.score - a.score; // within a tier, highest score first
      });
  }, [summaries]);

  const lastFetched = useMemo(() => {
    if (summaries.length === 0) return null;
    const latest = summaries.reduce((max, s) =>
      s.fetched_at > max ? s.fetched_at : max, summaries[0].fetched_at);
    return new Date(latest + 'Z');
  }, [summaries]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold text-gray-900">Daily Summaries</h1>
          {lastFetched && (
            <span className="text-[11px] text-gray-400">
              Last updated {lastFetched.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{' '}
              {lastFetched.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-gray-400">Forward analyst outlook (~12mo) — best first:</span>
          <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Bullish</span>
          <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Neutral</span>
          <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">Bearish</span>
        </div>
      </div>

      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Filter by ticker..."
          value={ticker}
          onChange={e => setTicker(e.target.value.toUpperCase())}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {date && (
          <button
            onClick={() => setDate('')}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Clear date
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="animate-pulse rounded-lg bg-gray-200 h-32" />
          ))}
        </div>
      ) : scored.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-500">No summaries found. Run <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">npm run daily-summaries</code> to fetch data.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {scored.map(({ summary, sentiment }) => (
            <SummaryCard
              key={`${summary.ticker}-${summary.date}`}
              summary={summary}
              sentiment={sentiment}
            />
          ))}
        </div>
      )}

      <SentimentTrends />
    </div>
  );
}
