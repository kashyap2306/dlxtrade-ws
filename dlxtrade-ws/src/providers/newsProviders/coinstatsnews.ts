import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const RSS_URL = 'https://coinstats.app/blog/feed/';

/**
 * Test connection to CoinStats News RSS
 * @param apiKey - Not required
 * @returns Promise with test result
 */
export async function testConnection(apiKey?: string): Promise<{ ok: boolean, message?: string }> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinStatsNews', endpoint: 'test-connection' });

    const response = await axios.get(RSS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 8000
    });

    if (response.status === 200 && response.data) {
      return { ok: true, message: 'CoinStats News RSS accessible' };
    }

    return { ok: false, message: `CoinStats News RSS returned status ${response.status}` };
  } catch (error: any) {
    console.error('CoinStatsNews testConnection error:', error.message);
    return { ok: false, message: `Connection failed: ${error.message}` };
  }
}

/**
 * Get crypto news from CoinStats News RSS
 * @param apiKey - Not required
 * @returns Promise with normalized news result
 */
export async function getCryptoNews(apiKey?: string): Promise<{ success: boolean; articles: any[]; reason?: string }> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinStatsNews', endpoint: 'rss' });

    const response = await axios.get(RSS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 10000
    });

    if (response.status !== 200 || !response.data) {
      console.warn(`CoinStats News RSS returned status ${response.status}`);
      return { success: false, articles: [], reason: `CoinStats RSS returned status ${response.status}` };
    }

    const xmlData = response.data.toString();
    const items: any[] = [];

    const itemParts = xmlData.split('<item>');
    itemParts.shift();

    for (const itemXml of itemParts.slice(0, 20)) {
      const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      const linkMatch = itemXml.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
      const descriptionMatch = itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
      const pubDateMatch = itemXml.match(/<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/i);

      if (titleMatch && linkMatch) {
        let summary = descriptionMatch ? descriptionMatch[1] : '';
        summary = summary.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (summary.length > 300) summary = summary.substring(0, 297) + '...';

        items.push({
          title: titleMatch[1].trim(),
          summary: summary,
          url: linkMatch[1].trim(),
          source: 'CoinStats',
          publishedAt: pubDateMatch ? new Date(pubDateMatch[1]).toISOString() : new Date().toISOString()
        });
      }
    }

    return {
      success: items.length > 0,
      articles: items,
      reason: items.length === 0 ? 'No articles found in RSS feed' : undefined
    };
  } catch (error: any) {
    console.error('CoinStatsNews getCryptoNews error:', error.message);
    return { success: false, articles: [], reason: `Fetch failed: ${error.message}` };
  }
}

