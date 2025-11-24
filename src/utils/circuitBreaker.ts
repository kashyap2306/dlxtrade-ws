export interface CircuitBreakerOptions {
  failureThreshold: number; // Number of failures before opening circuit
  recoveryTimeout: number; // Time in ms before trying again
  monitoringPeriod: number; // Time window to track failures
}

export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private nextAttemptTime: number = 0;

  constructor(private options: CircuitBreakerOptions) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttemptTime) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.options.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttemptTime = Date.now() + this.options.recoveryTimeout;
    }
  }

  getState(): string {
    return this.state;
  }

  isOpen(): boolean {
    return this.state === 'OPEN' && Date.now() < this.nextAttemptTime;
  }

  reset(): void {
    this.failures = 0;
    this.state = 'CLOSED';
    this.lastFailureTime = 0;
    this.nextAttemptTime = 0;
  }
}

// Global circuit breakers for providers
export const providerCircuitBreakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(providerName: string): CircuitBreaker {
  if (!providerCircuitBreakers.has(providerName)) {
    providerCircuitBreakers.set(providerName, new CircuitBreaker({
      failureThreshold: 3,
      recoveryTimeout: 30000, // 30 seconds
      monitoringPeriod: 60000 // 1 minute
    }));
  }
  return providerCircuitBreakers.get(providerName)!;
}
