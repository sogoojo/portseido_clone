/** Small request-local helper for browser-visible Server-Timing diagnostics. */
export class ServerTiming {
  private readonly startedAt = performance.now();
  private readonly entries: { name: string; duration: number; description?: string }[] = [];

  async measure<T>(name: string, work: () => Promise<T>, description?: string): Promise<T> {
    const startedAt = performance.now();
    try {
      return await work();
    } finally {
      this.entries.push({ name, duration: performance.now() - startedAt, description });
    }
  }

  header(): string {
    const entries = [
      ...this.entries,
      { name: 'total', duration: performance.now() - this.startedAt, description: undefined },
    ];
    return entries.map(({ name, duration, description }) => {
      const desc = description ? `;desc="${description.replaceAll('"', "'")}"` : '';
      return `${name};dur=${duration.toFixed(1)}${desc}`;
    }).join(', ');
  }
}
