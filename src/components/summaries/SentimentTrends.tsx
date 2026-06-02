'use client';

import { useState, useEffect, useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, ReferenceLine, Tooltip, XAxis } from 'recharts';
import type { DailySummary } from '@/lib/types';

const NEGATIVE_WORDS = new Set([
  'decline', 'declined', 'drop', 'drops', 'dropped', 'fall', 'falls', 'fell',
  'sell', 'selloff', 'selling', 'downgrade', 'downgraded', 'loss', 'losses',
  'crash', 'crashed', 'plunge', 'plunged', 'plunges', 'slump', 'slumped',
  'weak', 'weaken', 'cut', 'cuts', 'miss', 'missed', 'misses', 'concern',
  'concerns', 'risk', 'risks', 'fear', 'fears', 'tumble', 'tumbled', 'slide',
  'slides', 'slid', 'warning', 'warn', 'warns', 'layoff', 'layoffs',
  'bearish', 'underperform', 'overvalued', 'negative', 'pressure', 'retreat',
  'retreated', 'sinks', 'sank', 'worst', 'trouble', 'crisis', 'lawsuit',
  'fraud', 'investigation', 'probe', 'fine', 'fined', 'penalty',
]);

const POSITIVE_WORDS = new Set([
  'surge', 'surged', 'surges', 'rally', 'rallied', 'rallies', 'gain', 'gains',
  'gained', 'rise', 'rises', 'rose', 'upgrade', 'upgraded', 'beat', 'beats',
  'strong', 'stronger', 'growth', 'boost', 'boosted', 'soar', 'soared',
  'soars', 'jump', 'jumped', 'jumps', 'record', 'bullish', 'outperform',
  'buy', 'breakout', 'momentum', 'optimism', 'positive', 'innovation',
  'partnership', 'expansion', 'launch', 'launched', 'profit', 'profitable',
  'revenue', 'dividend', 'winner', 'best', 'upside', 'opportunity',
]);

function scoreSentiment(summary: DailySummary): number {
  let score = 0;
  const pct = summary.change_pct ?? 0;
  if (pct <= -3) score -= 2;
  else if (pct <= -1) score -= 1;
  else if (pct >= 3) score += 2;
  else if (pct >= 1) score += 1;

  for (const article of summary.news) {
    const words = article.title.toLowerCase().split(/[^a-z]+/);
    for (const w of words) {
      if (NEGATIVE_WORDS.has(w)) score -= 1;
      if (POSITIVE_WORDS.has(w)) score += 1;
    }
    if (article.snippet) {
      const snippetWords = article.snippet.toLowerCase().split(/[^a-z]+/);
      for (const w of snippetWords) {
        if (NEGATIVE_WORDS.has(w)) score -= 0.5;
        if (POSITIVE_WORDS.has(w)) score += 0.5;
      }
    }
  }
  return score;
}

type Period = '1W' | '1M' | '3M' | '1Y';

const PERIODS: { key: Period; label: string; days: number }[] = [
  { key: '1W', label: '1W', days: 7 },
  { key: '1M', label: '1M', days: 30 },
  { key: '3M', label: '3M', days: 90 },
  { key: '1Y', label: '1Y', days: 365 },
];

function getFromDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

interface TickerTrend {
  ticker: string;
  avgScore: number;
  trend: 'improving' | 'worsening' | 'stable';
  dataPoints: { date: string; score: number }[];
}

function computeTrends(summaries: DailySummary[]): TickerTrend[] {
  const byTicker = new Map<string, DailySummary[]>();
  for (const s of summaries) {
    const list = byTicker.get(s.ticker) || [];
    list.push(s);
    byTicker.set(s.ticker, list);
  }

  const trends: TickerTrend[] = [];
  for (const [ticker, items] of byTicker) {
    const sorted = items.sort((a, b) => a.date.localeCompare(b.date));
    const dataPoints = sorted.map(s => ({ date: s.date, score: scoreSentiment(s) }));
    const scores = dataPoints.map(d => d.score);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    let trend: 'improving' | 'worsening' | 'stable' = 'stable';
    if (scores.length >= 3) {
      const half = Math.floor(scores.length / 2);
      const firstHalf = scores.slice(0, half);
      const secondHalf = scores.slice(half);
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      const diff = secondAvg - firstAvg;
      if (diff >= 1.5) trend = 'improving';
      else if (diff <= -1.5) trend = 'worsening';
    }

    trends.push({ ticker, avgScore, trend, dataPoints });
  }

  return trends.sort((a, b) => a.avgScore - b.avgScore);
}

const TREND_ARROW: Record<string, { icon: string; color: string }> = {
  improving: { icon: '↑', color: 'text-green-600' },
  worsening: { icon: '↓', color: 'text-red-600' },
  stable: { icon: '→', color: 'text-gray-400' },
};

function sentimentColor(avg: number): string {
  if (avg <= -2) return 'text-red-600';
  if (avg >= 2) return 'text-green-600';
  return 'text-amber-600';
}

function sentimentBg(avg: number): string {
  if (avg <= -2) return 'bg-red-50';
  if (avg >= 2) return 'bg-green-50';
  return 'bg-amber-50';
}

function sentimentLabel(avg: number): string {
  if (avg <= -2) return 'Bearish';
  if (avg >= 2) return 'Bullish';
  return 'Neutral';
}

function sparkColor(avg: number): string {
  if (avg <= -2) return '#dc2626';
  if (avg >= 2) return '#16a34a';
  return '#d97706';
}

function sparkFill(avg: number): string {
  if (avg <= -2) return '#fecaca';
  if (avg >= 2) return '#bbf7d0';
  return '#fef3c7';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SparkTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded bg-gray-800 px-2 py-1 text-[10px] text-white shadow">
      {d.date}: {d.score >= 0 ? '+' : ''}{d.score.toFixed(1)}
    </div>
  );
}

function TrendRow({ trend }: { trend: TickerTrend }) {
  const arrow = TREND_ARROW[trend.trend];
  const color = sparkColor(trend.avgScore);
  const fill = sparkFill(trend.avgScore);

  return (
    <div className={`flex items-center gap-3 rounded-lg border border-gray-100 px-4 py-3 ${sentimentBg(trend.avgScore)}`}>
      <div className="w-20 shrink-0">
        <p className="text-sm font-semibold text-gray-900">{trend.ticker}</p>
        <p className={`text-[10px] font-medium ${sentimentColor(trend.avgScore)}`}>
          {sentimentLabel(trend.avgScore)}
        </p>
      </div>

      <div className="w-12 shrink-0 text-center">
        <span className={`text-lg ${arrow.color}`}>{arrow.icon}</span>
        <p className="text-[9px] text-gray-400">{trend.trend}</p>
      </div>

      <div className="flex-1 h-10 min-w-0">
        {trend.dataPoints.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend.dataPoints}>
              <defs>
                <linearGradient id={`grad-${trend.ticker}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={fill} stopOpacity={0.8} />
                  <stop offset="100%" stopColor={fill} stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <Tooltip content={<SparkTooltip />} />
              <ReferenceLine y={0} stroke="#d1d5db" strokeDasharray="2 2" />
              <Area
                type="monotone"
                dataKey="score"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#grad-${trend.ticker})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-[10px] text-gray-400">
            Not enough data
          </div>
        )}
      </div>

      <div className="w-14 shrink-0 text-right">
        <p className={`text-sm font-semibold tabular-nums ${sentimentColor(trend.avgScore)}`}>
          {trend.avgScore >= 0 ? '+' : ''}{trend.avgScore.toFixed(1)}
        </p>
        <p className="text-[9px] text-gray-400">{trend.dataPoints.length}d</p>
      </div>
    </div>
  );
}

export default function SentimentTrends() {
  const [period, setPeriod] = useState<Period>('1M');
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const days = PERIODS.find(p => p.key === period)!.days;
    const from = getFromDate(days);
    fetch(`/api/summaries?from=${from}&limit=200`)
      .then(r => r.json())
      .then(json => {
        setSummaries(Array.isArray(json.data) ? json.data : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period]);

  const trends = useMemo(() => computeTrends(summaries), [summaries]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
          Sentiment Trends
        </h2>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                period === p.key
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse rounded-lg bg-gray-200 h-16" />
          ))}
        </div>
      ) : trends.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">
          No historical data for this period yet.
        </p>
      ) : (
        <div className="space-y-2">
          {trends.map(t => (
            <TrendRow key={t.ticker} trend={t} />
          ))}
        </div>
      )}
    </div>
  );
}
