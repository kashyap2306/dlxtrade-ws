import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://www.altcoinbuzz.io/feed/';

/**
 * Test connection to AltcoinBuzz RSS feed
 * @param apiKey - Not required for RSS feeds
 * @returns Promise with test result
 */
export async function testConnection(apiKey?: string): Promise<{ ok: boolean, message?: string }> {
  try {
    console.log('PROVIDER-CALL', { provider: 'AltcoinBuzz', endpoint: 'test-connection' });

    const response = await retryWithBackoff(async () => {
      return axios.get(BASE_URL, {
        headers: {
          'User-Agent': 'DLXTrade/1.0'
        },
        timeout: 8000
      });
    });

    if (response.status === 200 && response.data) {
      return { ok: true, message: 'AltcoinBuzz RSS feed accessible' };
    }

    return { ok: false, message: `AltcoinBuzz RSS returned status ${response.status}` };
  } catch (error: any) {
    console.error('AltcoinBuzz testConnection error:', error.message);
    return { ok: false, message: `Connection failed: ${error.message}` };
  }
}

/**
 * Get crypto news from AltcoinBuzz RSS feed
 * @param apiKey - Not required for RSS feeds
 * @returns Promise with normalized news data
 */
export async function getCryptoNews(apiKey?: string): Promise<any[]> {
  try {
    console.log('PROVIDER-CALL', { provider: 'AltcoinBuzz', endpoint: 'rss' });

    const response = await retryWithBackoff(async () => {
      return axios.get(BASE_URL, {
        headers: {
          'User-Agent': 'DLXTrade/1.0'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data) {
      throw new Error(`AltcoinBuzz RSS returned status ${response.status}`);
    }

    // Parse RSS XML - basic parsing for common RSS structure
    const xmlData = response.data;
    const items: any[] = [];

    // Extract items from RSS XML using regex (basic parsing)
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>/g;
    const linkRegex = /<link>(.*?)<\/link>/g;
    const descriptionRegex = /<description><!\[CDATA\[(.*?)\]\]><\/description>/g;
    const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/g;

    let itemMatch;
    let index = 0;
    while ((itemMatch = itemRegex.exec(xmlData)) !== null && index < 20) {
      const itemXml = itemMatch[1];

      const titleMatch = titleRegex.exec(itemXml);
      const linkMatch = linkRegex.exec(itemXml);
      const descriptionMatch = descriptionRegex.exec(itemXml);
      const pubDateMatch = pubDateRegex.exec(itemXml);

      if (titleMatch && linkMatch) {
        // Filter for crypto-related posts
        const title = titleMatch[1] || '';
        const isCryptoRelated = /bitcoin|ethereum|crypto|blockchain|nft|defi|altcoin/i.test(title);

        if (isCryptoRelated) {
          items.push({
            title: title,
            summary: descriptionMatch ? descriptionMatch[1]?.substring(0, 200) + '...' : '',
            url: linkMatch[1] || '',
            source: 'AltcoinBuzz',
            publishedAt: pubDateMatch ? new Date(pubDateMatch[1]).toISOString() : new Date().toISOString(),
            sentiment: Math.random() * 2 - 1 // Basic sentiment placeholder
          });
          index++;
        }
      }

      // Reset regex lastIndex for next iteration
      titleRegex.lastIndex = 0;
      linkRegex.lastIndex = 0;
      descriptionRegex.lastIndex = 0;
      pubDateRegex.lastIndex = 0;
    }

    return items.slice(0, 15); // Limit to 15 articles
  } catch (error: any) {
    console.error('AltcoinBuzz getCryptoNews error:', error.message);
    throw extractAdapterError('AltcoinBuzz', 'getCryptoNews', BASE_URL, error);
  }
}

