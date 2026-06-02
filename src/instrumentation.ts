export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const cron = await import('node-cron');
    const { collectDailySummaries } = await import('@/lib/services/collect-summaries');

    // 9:30 PM UK time, Monday-Friday (after US market close)
    cron.schedule('30 21 * * 1-5', async () => {
      console.log('[Cron] Running daily summaries...');
      try {
        const result = await collectDailySummaries();
        console.log(`[Cron] Done: ${result.success}/${result.total} summaries for ${result.date}`);
      } catch (err) {
        console.error('[Cron] Failed:', err);
      }
    }, { timezone: 'Europe/London' });

    console.log('[Cron] Daily summaries scheduled for 21:30 Europe/London, Mon-Fri');
  }
}
