import { AdapterError } from '../utils/adapterErrorHandler';
import { retryWithBackoff } from '../utils/rateLimiter';
import axios from 'axios';
import { logger } from '../utils/logger';

const BASE_URL = 'https://api.twitter.com/2';

export async function fetchTwitterCryptoNews(apiKey: string, query: string = 'cryptocurrency OR bitcoin OR ethereum'): Promise<any> {
  try {
    const url = `${BASE_URL}/tweets/search/recent`;

    const response = await retryWithBackoff(async () => {
      return await axios.get(url, {
        params: {
          query: query,
          max_results: 10,
          'tweet.fields': 'created_at,public_metrics,text,author_id',
          'user.fields': 'username,name'
        },
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 10000
      });
    });

    if (response.data && response.data.data) {
      return response.data.data.map((tweet: any) => ({
        id: tweet.id,
        text: tweet.text,
        created_at: tweet.created_at,
        author_id: tweet.author_id,
        public_metrics: tweet.public_metrics,
        username: response.data.includes?.users?.find((user: any) => user.id === tweet.author_id)?.username,
        name: response.data.includes?.users?.find((user: any) => user.id === tweet.author_id)?.name
      }));
    }

    throw new AdapterError({
      adapter: 'Twitter',
      method: 'GET',
      url: BASE_URL,
      errorMessage: 'Invalid response from Twitter API',
      isAuthError: false
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Twitter adapter error');
    throw new AdapterError({
      adapter: 'Twitter',
      method: 'GET',
      url: BASE_URL,
      errorMessage: `Twitter API error: ${error.message}`,
      isAuthError: false
    });
  }
}
