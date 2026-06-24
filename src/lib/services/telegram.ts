// Minimal Telegram Bot API client. No SDK — a single sendMessage call is all we
// need. Configure via two env vars (Fly secrets in production):
//   TELEGRAM_BOT_TOKEN  — from @BotFather
//   TELEGRAM_CHAT_ID    — your own chat id (hit getUpdates once to find it)

const TELEGRAM_API = 'https://api.telegram.org';

/** True when both bot token and chat id are present. */
export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/**
 * Send a plain-text message to the configured chat. Plain text (no parse_mode)
 * sidesteps Markdown/HTML escaping bugs — fine for short reminders.
 * Throws on misconfiguration or a non-2xx response so callers can react.
 */
export async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('Telegram not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)');
  }

  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram sendMessage failed (${res.status}): ${body}`);
  }
}
