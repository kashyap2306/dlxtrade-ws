// Semaphore for concurrency control
export class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits--;
      return () => this.release();
    }

    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.permits--;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.permits++;
    if (this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      next();
    }
  }
}

/**
 * In-memory cache for symbol metadata
 */
export const symbolCache = new Map<string, { data: string[]; timestamp: number; ttl: number }>();

/**
 * Normalize symbol by removing common quote currencies
 */
export function normalizeSymbol(s: string): string {
  if (s.endsWith("USDT")) return s.replace("USDT", "");
  if (s.endsWith("USD")) return s.replace("USD", "");
  return s;
}
export const SYMBOL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

