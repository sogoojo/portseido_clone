import { getDueReminders, markNotified } from './notes';
import { isTelegramConfigured, sendTelegramMessage } from './telegram';
import type { PortfolioNote } from '@/lib/types';

export interface ReminderRunResult {
  due: number;        // open items whose reminder is due
  sent: number;       // pushes delivered + stamped this run
  failed: number;     // due items we couldn't deliver (left pending to retry)
  configured: boolean;// whether Telegram creds are present
}

function messageFor(n: PortfolioNote): string {
  const label = n.portfolio === 'ngx' ? 'NGX' : 'Global';
  const ticker = n.ticker ? ` (${n.ticker})` : '';
  return `⏰ Reminder — ${label}${ticker}: ${n.text}`;
}

/**
 * Deliver any due action-item reminders via Telegram, marking each as notified
 * so it fires exactly once. Items are only stamped after a successful send, so a
 * transient Telegram failure (or missing config) leaves them due to retry on the
 * next cron tick rather than silently dropping the reminder.
 */
export async function runReminders(): Promise<ReminderRunResult> {
  const due = getDueReminders();
  const configured = isTelegramConfigured();

  if (due.length === 0) return { due: 0, sent: 0, failed: 0, configured };
  if (!configured) {
    // Leave everything pending — they'll deliver once the Fly secrets are set.
    return { due: due.length, sent: 0, failed: due.length, configured: false };
  }

  let sent = 0;
  let failed = 0;
  for (const n of due) {
    try {
      await sendTelegramMessage(messageFor(n));
      markNotified(n.id);
      sent++;
    } catch (err) {
      console.error('[reminders] delivery failed for note', n.id, err);
      failed++;
    }
  }
  return { due: due.length, sent, failed, configured: true };
}
