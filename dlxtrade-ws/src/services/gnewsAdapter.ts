import { AdapterError } from '../utils/adapterErrorHandler';
import { retryWithBackoff } from '../utils/rateLimiter';
import axios from 'axios';
import { logger } from '../utils/logger';

const BASE_URL = 'https://gnews.io/api/v4';

export async function fetchGNews(apiKey: string, query: string = 'cryptocurrency OR bitcoin OR ethereum'): Promise<any> {
  try {
    const url = `${BASE_URL}/search`;

    const response = await retryWithBackoff(async () => {
      return await axios.get(url, {
        params: {
          q: query,
          lang: 'en',
          country: 'us',
          max: 10,
          apikey: apiKey
        },
        timeout: 10000
      });
    });

    if (response.data && response.data.articles) {
      return response.data.articles.map((article: any) => ({
        title: article.title,
        description: article.description,
        content: article.content,
        url: article.url,
        image: article.image,
        publishedAt: article.publishedAt,
        source: {
          name: article.source.name,
          url: article.source.url
        }
      }));
    }

    throw new AdapterError({
      adapter: 'GNews',
      method: 'GET',
      url: BASE_URL,
      errorMessage: 'Invalid response from GNews API',
      isAuthError: false
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'GNews adapter error');
    throw new AdapterError({
      adapter: 'GNews',
      method: 'GET',
      url: BASE_URL,
      errorMessage: `GNews API error: ${error.message}`,
      isAuthError: false
    });
  }
}
