import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://cointelegraph.com/rss';

/**
 * Test connection to Cointelegraph RSS feed
 * @param apiKey - Not required for RSS feeds
 * @returns Promise with test result
 */
export async function testConnection(apiKey?: string): Promise<{ ok: boolean, message?: string }> {
  try {
    console.log('PROVIDER-CALL', { provider: 'Cointelegraph', endpoint: 'test-connection' });

    const response = await retryWithBackoff(async () => {
      return axios.get(BASE_URL, {
        headers: {
          'User-Agent': 'DLXTrade/1.0'
        },
        timeout: 8000
      });
    });

    if (response.status === 200 && response.data) {
      return { ok: true, message: 'Cointelegraph RSS feed accessible' };
    }

    return { ok: false, message: `Cointelegraph RSS returned status ${response.status}` };
  } catch (error: any) {
    console.error('Cointelegraph testConnection error:', error.message);
    return { ok: false, message: `Connection failed: ${error.message}` };
  }
}

/**
 * Get crypto news from Cointelegraph RSS feed
 * @param apiKey - Not required for RSS feeds
 * @returns Promise with normalized news result
 */
export async function getCryptoNews(apiKey?: string): Promise<{ success: boolean; articles: any[]; reason?: string }> {
  try {
    console.log('PROVIDER-CALL', { provider: 'Cointelegraph', endpoint: 'rss' });

    const response = await axios.get(BASE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });

    if (response.status !== 200 || !response.data) {
      console.warn(`Cointelegraph RSS returned status ${response.status}`);
      return { success: false, articles: [], reason: `Cointelegraph RSS returned status ${response.status}` };
    }

    const xmlData = response.data.toString();
    const items: any[] = [];

    // Improved item extraction
    const itemParts = xmlData.split('<item>');
    itemParts.shift(); // Remove content before first <item>

    for (const itemXml of itemParts.slice(0, 20)) {
      // Robust regex for title, link, description/summary, and pubDate
      const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      const linkMatch = itemXml.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
      const descriptionMatch = itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
      const pubDateMatch = itemXml.match(/<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/i);

      if (titleMatch && linkMatch) {
        let summary = descriptionMatch ? descriptionMatch[1] : '';
        // Basic HTML cleanup and snippet truncation
        summary = summary.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (summary.length > 300) summary = summary.substring(0, 297) + '...';

        items.push({
          title: titleMatch[1].trim(),
          summary: summary,
          url: linkMatch[1].trim(),
          source: 'Cointelegraph',
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
    console.error('Cointelegraph getCryptoNews error:', error.message);
    return { success: false, articles: [], reason: `Fetch failed: ${error.message}` };
  }
}

