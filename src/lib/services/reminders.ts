import { getDueReminders, getOpenPriceTriggers, isTriggerHit, markNotified } from './notes';
import { getMultipleCurrentPrices } from './prices';
import { isTelegramConfigured, sendTelegramMessage } from './telegram';
import type { PortfolioNote } from '@/lib/types';

export interface ReminderRunResult {
  due: number;        // items due this run (time reminders + crossed price triggers)
  sent: number;       // pushes delivered + stamped this run
  failed: number;     // due items we couldn't deliver (left pending to retry)
  configured: boolean;// whether Telegram creds are present
}

function messageFor(n: PortfolioNote): string {
  const label = n.portfolio === 'ngx' ? 'NGX' : 'Global';
  const ticker = n.ticker ? ` (${n.ticker})` : '';
  return `⏰ Reminder — ${label}${ticker}: ${n.text}`;
}

function triggerMessageFor(n: PortfolioNote, price: number, currency: string): string {
  const label = n.portfolio === 'ngx' ? 'NGX' : 'Global';
  const dir = n.trigger_direction === 'below' ? '≤' : '≥';
  return `🎯 ${n.ticker} at ${price.toFixed(2)} ${currency} (${dir} ${n.trigger_price}) — ${label}: ${n.text}`;
}

/**
 * Open price triggers whose condition is currently met, paired with the price
 * that satisfied it. Prices come from the ticker's native source (Yahoo or
 * TradingView) via the shared cache. Stale prices (fetch failed, cache old)
 * don't fire — the item stays armed and re-checks on the next cron tick.
 */
async function getCrossedTriggers(): Promise<{ note: PortfolioNote; price: number; currency: string }[]> {
  const armed = getOpenPriceTriggers();
  if (armed.length === 0) return [];

  const tickers = [...new Set(armed.map(n => n.ticker as string))];
  const prices = await getMultipleCurrentPrices(tickers);
  const byTicker = new Map(prices.map(p => [p.ticker, p]));

  const crossed: { note: PortfolioNote; price: number; currency: string }[] = [];
  for (const n of armed) {
    const quote = byTicker.get(n.ticker as string);
    if (!quote || quote.price == null || quote.stale) continue;
    if (isTriggerHit(quote.price, n.trigger_price as number, n.trigger_direction ?? 'above')) {
      crossed.push({ note: n, price: quote.price, currency: quote.currency });
    }
  }
  return crossed;
}

/**
 * Deliver any due action-item reminders via Telegram, marking each as notified
 * so it fires exactly once. Two kinds of "due": time reminders (remind_at has
 * passed) and price triggers (ticker crossed trigger_price). Items are only
 * stamped after a successful send, so a transient Telegram failure (or missing
 * config) leaves them due to retry on the next cron tick rather than silently
 * dropping the reminder.
 */
export async function runReminders(): Promise<ReminderRunResult> {
  const configured = isTelegramConfigured();

  const timeDue = getDueReminders();
  let crossed: { note: PortfolioNote; price: number; currency: string }[] = [];
  try {
    crossed = await getCrossedTriggers();
  } catch (err) {
    // Price sources down — time reminders still deliver; triggers retry next tick.
    console.error('[reminders] price-trigger check failed', err);
  }
  // A note with both a time reminder and a price trigger fires once — dedupe.
  const crossedOnly = crossed.filter(c => !timeDue.some(n => n.id === c.note.id));

  const due = timeDue.length + crossedOnly.length;
  if (due === 0) return { due: 0, sent: 0, failed: 0, configured };
  if (!configured) {
    // Leave everything pending — they'll deliver once the Fly secrets are set.
    return { due, sent: 0, failed: due, configured: false };
  }

  let sent = 0;
  let failed = 0;
  const deliveries: { id: number; text: string }[] = [
    ...timeDue.map(n => ({ id: n.id, text: messageFor(n) })),
    ...crossedOnly.map(c => ({ id: c.note.id, text: triggerMessageFor(c.note, c.price, c.currency) })),
  ];
  for (const d of deliveries) {
    try {
      await sendTelegramMessage(d.text);
      markNotified(d.id);
      sent++;
    } catch (err) {
      console.error('[reminders] delivery failed for note', d.id, err);
      failed++;
    }
  }
  return { due, sent, failed, configured: true };
}
