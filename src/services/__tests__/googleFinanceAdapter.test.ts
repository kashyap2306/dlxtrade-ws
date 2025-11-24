import { GoogleFinanceAdapter } from '../googleFinanceAdapter';

describe('GoogleFinanceAdapter', () => {
  let adapter: typeof GoogleFinanceAdapter;

  beforeEach(() => {
    adapter = GoogleFinanceAdapter;
  });

  it('should have getExchangeRates method', () => {
    expect(typeof adapter.getExchangeRates).toBe('function');
  });

  it('should return exchange rates with correct structure', async () => {
    const result = await adapter.getExchangeRates();

    expect(result).toHaveProperty('base');
    expect(result).toHaveProperty('rates');
    expect(result).toHaveProperty('timestamp');
    expect(typeof result.base).toBe('string');
    expect(typeof result.rates).toBe('object');
    expect(typeof result.timestamp).toBe('number');

    // Check that USD rate is 1.0
    expect(result.rates['USD']).toBe(1.0);

    // Check that INR rate is present and reasonable (allow for fallback rates)
    expect(result.rates['INR']).toBeGreaterThan(50);
    expect(result.rates['INR']).toBeLessThan(120);
  });

  it('should handle errors gracefully', async () => {
    // Mock a failure scenario
    const originalHttpClient = adapter.httpClient;
    adapter.httpClient = null as any;

    const result = await adapter.getExchangeRates();

    // Should still return valid structure with fallback rates
    expect(result).toHaveProperty('base');
    expect(result).toHaveProperty('rates');
    expect(result).toHaveProperty('timestamp');

    // Restore original client
    adapter.httpClient = originalHttpClient;
  });
});
