import { AdapterError } from '../utils/adapterErrorHandler';
import { retryWithBackoff } from '../utils/rateLimiter';
import axios from 'axios';
import { logger } from '../utils/logger';

const BASE_URL = 'https://www.reddit.com/r';

export async function fetchRedditCryptoNews(subreddit: string = 'cryptocurrency'): Promise<any> {
  try {
    const url = `${BASE_URL}/${subreddit}/hot.json`;

    const response = await retryWithBackoff(async () => {
      return await axios.get(url, {
        params: {
          limit: 25
        },
        timeout: 10000
      });
    });

    if (response.data && response.data.data && response.data.data.children) {
      return response.data.data.children.map((post: any) => ({
        id: post.data.id,
        title: post.data.title,
        selftext: post.data.selftext,
        url: post.data.url,
        permalink: post.data.permalink,
        score: post.data.score,
        num_comments: post.data.num_comments,
        created_utc: post.data.created_utc,
        author: post.data.author,
        subreddit: post.data.subreddit,
        ups: post.data.ups,
        downs: post.data.downs
      }));
    }

    throw new AdapterError({
      adapter: 'Reddit',
      method: 'GET',
      url: BASE_URL,
      errorMessage: 'Invalid response from Reddit API',
      isAuthError: false
    });
  } catch (error: any) {
    logger.error({ error: error.message, subreddit }, 'Reddit adapter error');
    throw new AdapterError({
      adapter: 'Reddit',
      method: 'GET',
      url: BASE_URL,
      errorMessage: `Reddit API error: ${error.message}`,
      isAuthError: false
    });
  }
}
