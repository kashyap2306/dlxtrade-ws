import { fetchCryptoPanicNews } from '../services/cryptoPanicAdapter';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CryptoPanicAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchCryptoPanicNews', () => {
    it('should return successful response with valid data', async () => {
      const mockResponse = {
        data: {
          results: [
            {
              title: 'Bitcoin surges to new highs',
              url: 'https://example.com/news1',
              source: { title: 'Crypto News' },
              published_at: '2024-01-01T00:00:00Z',
              tags: [{ slug: 'bullish' }]
            }
          ]
        },
        status: 200
      };

      mockedAxios.get.mockResolvedValue(mockResponse);

      const result = await fetchCryptoPanicNews('test-api-key');

      expect(result.success).toBe(true);
      expect(result.articles).toHaveLength(1);
      expect(result.sentiment).toBeGreaterThan(0.5); // Bullish sentiment
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://newsdata.io/api/1/news?auth_token=test-api-key&kind=news',
        expect.any(Object)
      );
    });

    it('should handle 429 rate limiting with retry logic', async () => {
      const rateLimitError = {
        response: { status: 429, data: { message: 'Rate limit exceeded' } }
      };

      const successResponse = {
        data: {
          results: [
            {
              title: 'Market analysis',
              url: 'https://example.com/news1',
              source: { title: 'Crypto News' },
              published_at: '2024-01-01T00:00:00Z',
              tags: []
            }
          ]
        },
        status: 200
      };

      // First call fails with 429, second succeeds
      mockedAxios.get
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(successResponse);

      const result = await fetchCryptoPanicNews('test-api-key');

      expect(result.success).toBe(true);
      expect(result.articles).toHaveLength(1);
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('should fallback to empty news after all retries fail with 429', async () => {
      const rateLimitError = {
        response: { status: 429, data: { message: 'Rate limit exceeded' } }
      };

      // All 3 attempts fail with 429
      mockedAxios.get
        .mockRejectedValueOnce(rateLimitError)
        .mockRejectedValueOnce(rateLimitError)
        .mockRejectedValueOnce(rateLimitError);

      const result = await fetchCryptoPanicNews('test-api-key');

      expect(result.success).toBe(true);
      expect(result.articles).toHaveLength(0);
      expect(result.sentiment).toBe(0.5);
      expect(result.message).toContain('Rate-limited');
      expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    });

    it('should handle authentication errors (401/403)', async () => {
      const authError = {
        response: { status: 401, data: { message: 'Invalid API key' } }
      };

      mockedAxios.get.mockRejectedValue(authError);

      await expect(fetchCryptoPanicNews('invalid-key')).rejects.toThrow(
        'Authentication failed - invalid API key'
      );
    });

    it('should fallback gracefully on network errors', async () => {
      const networkError = new Error('Network timeout');
      (networkError as any).code = 'ECONNABORTED';

      mockedAxios.get.mockRejectedValue(networkError);

      const result = await fetchCryptoPanicNews('test-api-key');

      expect(result.success).toBe(true);
      expect(result.articles).toHaveLength(0);
      expect(result.sentiment).toBe(0.5);
      expect(result.message).toContain('Error occurred');
    });

    it('should use fallback API key when none provided', async () => {
      const mockResponse = {
        data: { results: [] },
        status: 200
      };

      mockedAxios.get.mockResolvedValue(mockResponse);

      // Mock process.env
      const originalEnv = process.env;
      process.env = { ...originalEnv, CRYPTOPANIC_DEFAULT_KEY: 'fallback-key' };

      await fetchCryptoPanicNews();

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://newsdata.io/api/1/news?auth_token=fallback-key&kind=news',
        expect.any(Object)
      );

      process.env = originalEnv;
    });

    it('should use public endpoint when no API key available', async () => {
      const mockResponse = {
        data: { results: [] },
        status: 200
      };

      mockedAxios.get.mockResolvedValue(mockResponse);

      await fetchCryptoPanicNews();

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://newsdata.io/api/1/news?public=true&kind=news',
        expect.any(Object)
      );
    });

    it('should calculate sentiment correctly', async () => {
      const mockResponse = {
        data: {
          results: [
            {
              title: 'Bullish news',
              url: 'https://example.com/news1',
              source: { title: 'Crypto News' },
              published_at: '2024-01-01T00:00:00Z',
              tags: [{ slug: 'bullish' }, { slug: 'positive' }]
            },
            {
              title: 'Bearish news',
              url: 'https://example.com/news2',
              source: { title: 'Crypto News' },
              published_at: '2024-01-01T00:00:00Z',
              tags: [{ slug: 'bearish' }]
            }
          ]
        },
        status: 200
      };

      mockedAxios.get.mockResolvedValue(mockResponse);

      const result = await fetchCryptoPanicNews('test-api-key');

      expect(result.sentiment).toBeCloseTo(0.5, 1); // Neutral due to mixed signals
    });
  });
});
