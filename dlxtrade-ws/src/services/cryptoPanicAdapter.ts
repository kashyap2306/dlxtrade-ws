import { AdapterError } from '../utils/adapterErrorHandler';
import { retryWithBackoff } from '../utils/rateLimiter';
import axios from 'axios';
import { logger } from '../utils/logger';

const BASE_URL = 'https://cryptopanic.com/api/v1';

export async function fetchCryptoPanicNews(apiKey?: string): Promise<any> {
  try {
    const url = `${BASE_URL}/posts/`;

    const response = await retryWithBackoff(async () => {
      return await axios.get(url, {
        params: {
          auth_token: apiKey,
          public: true,
          kind: 'news'
        },
        timeout: 10000
      });
    });

    if (response.data && response.data.results) {
      return response.data.results.map((post: any) => ({
        id: post.id,
        title: post.title,
        url: post.url,
        published_at: post.published_at,
        domain: post.domain,
        votes: post.votes,
        negative_votes: post.negative_votes,
        positive_votes: post.positive_votes,
        comments_count: post.comments_count,
        source: {
          title: post.source?.title,
          domain: post.source?.domain
        }
      }));
    }

    throw new AdapterError({
      adapter: 'CryptoPanic',
      method: 'GET',
      url: BASE_URL,
      errorMessage: 'Invalid response from CryptoPanic API',
      isAuthError: false
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'CryptoPanic adapter error');
    throw new AdapterError({
      adapter: 'CryptoPanic',
      method: 'GET',
      url: BASE_URL,
      errorMessage: `CryptoPanic API error: ${error.message}`,
      isAuthError: false
    });
  }
}
