/**
 * Token bucket rate limiter implementation
 */
export class TokenBucketRateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per millisecond
  private lastRefill: number;

  constructor(maxTokens: number, refillRatePerSecond: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRatePerSecond / 1000; // Convert to per millisecond
    this.lastRefill = Date.now();
  }

  /**
   * Attempt to consume a token
   * @returns true if token was consumed, false if rate limited
   */
  consume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Refill tokens based on time elapsed
   */
  private refill(): void {
    const now = Date.now();
    const timeElapsed = now - this.lastRefill;
    const tokensToAdd = timeElapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Get current token count (for debugging)
   */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Wait until a token is available
   */
  async waitForToken(): Promise<void> {
    while (!this.consume()) {
      // Calculate wait time for next token
      const waitTime = Math.ceil((1 - this.tokens) / this.refillRate);
      await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 1000)));
    }
  }
}

/**
 * Provider-specific rate limiters
 */
export const rateLimiters = {
  // CryptoCompare: 100 requests per minute (free tier)
  cryptocompare: new TokenBucketRateLimiter(100, 100 / 60),

  // NewsData: 200 requests per day (free tier)
  newsdata: new TokenBucketRateLimiter(200, 200 / (24 * 60 * 60)),

  // CoinMarketCap: 10,000 requests per month (free tier)
  coinmarketcap: new TokenBucketRateLimiter(10000, 10000 / (30 * 24 * 60 * 60)),

  // Binance Public: No rate limit for public endpoints
  binance: new TokenBucketRateLimiter(1000, 1000), // Effectively unlimited
};

/**
 * Exponential backoff retry utility
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  rateLimiter?: TokenBucketRateLimiter
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Check rate limit if provided
      if (rateLimiter) {
        if (!rateLimiter.consume()) {
          await rateLimiter.waitForToken();
        }
      }

      return await fn();
    } catch (error: any) {
      lastError = error;

      // Don't retry on auth errors
      if (error.response?.status === 401 || error.response?.status === 403) {
        throw error;
      }

      // Don't retry on the last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      console.log(`[RETRY] Attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${Math.round(delay)}ms:`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}
