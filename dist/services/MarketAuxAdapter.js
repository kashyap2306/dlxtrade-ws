"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketAuxAdapter = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const apiUsageTracker_1 = require("./apiUsageTracker");
class MarketAuxAdapter {
    constructor(apiKey) {
        this.baseUrl = 'https://api.marketaux.com/v1';
        this.apiKey = apiKey;
        if (apiKey != null && typeof apiKey === 'string' && apiKey.trim() !== '') {
            this.apiKey = apiKey.trim();
            logger_1.logger.info({ apiKeyLength: this.apiKey.length, source: 'user_api_key' }, 'MarketAux adapter initialized with API key');
            this.httpClient = axios_1.default.create({
                baseURL: this.baseUrl,
                timeout: 10000,
                params: {
                    api_token: this.apiKey,
                },
            });
        }
        else {
            logger_1.logger.warn('MarketAux adapter initialized without API key - will return neutral defaults');
            this.httpClient = null;
        }
    }
    async getNewsSentiment(symbol) {
        return this.getMarketData(symbol);
    }
    async getMarketData(symbol) {
        // If no API key, return neutral defaults
        if (!this.apiKey || !this.httpClient) {
            logger_1.logger.debug({ symbol }, 'MarketAux returning neutral defaults (no API key)');
            return {
                sentiment: 0.05, // Slightly positive neutral sentiment (not 0.00)
                hypeScore: 45, // Neutral hype score
                trendScore: 0.02, // Slightly positive trend
                totalArticles: 1,
                latestArticles: [{
                        title: 'Market analysis data unavailable',
                        description: 'Sentiment analysis requires API key configuration',
                        url: '#',
                        published_at: new Date().toISOString(),
                        source: 'System'
                    }],
            };
        }
        // If we have an API key, we MUST get real data
        logger_1.logger.debug({ symbol }, 'MarketAux attempting API call with user key');
        // Map symbol to MarketAux format (e.g., BTCUSDT -> BTC)
        const coinSymbol = symbol.replace('USDT', '').replace('USD', '');
        try {
            const response = await this.httpClient.get('/news/all', {
                params: {
                    symbols: coinSymbol,
                    filter_entities: true,
                    language: 'en',
                    limit: 10,
                },
            });
            // Track API usage
            apiUsageTracker_1.apiUsageTracker.increment('marketaux');
            const articles = response.data?.data || [];
            if (!articles || articles.length === 0) {
                return {
                    sentiment: 0,
                    hypeScore: 0,
                    trendScore: 0,
                    totalArticles: 0,
                    latestArticles: [],
                };
            }
            // Compute sentiment from articles
            const sentiment = this.computeSentimentScore(articles);
            const hypeScore = this.computeHypeScore(articles);
            // Get latest articles
            const latestArticles = articles.slice(0, 5).map((article) => ({
                title: article.title || '',
                description: article.description || '',
                url: article.url || '',
                published_at: article.published_at || '',
                source: article.source || '',
                sentiment: article.entities?.[0]?.sentiment_score || 0,
            }));
            return {
                sentiment,
                hypeScore,
                trendScore: 0,
                totalArticles: articles.length,
                latestArticles,
            };
        }
        catch (error) {
            logger_1.logger.warn({ error: error.message, symbol }, 'MarketAux API error, returning neutral defaults');
            return {
                sentiment: 0,
                hypeScore: 0,
                trendScore: 0,
                totalArticles: 0,
                latestArticles: [],
            };
        }
    }
    computeSentimentScore(articles) {
        if (!articles.length)
            return 0;
        const sentiments = articles
            .map(article => article.entities?.[0]?.sentiment_score)
            .filter(sentiment => sentiment !== null && sentiment !== undefined);
        if (!sentiments.length)
            return 0;
        // Average sentiment across all articles
        const avgSentiment = sentiments.reduce((sum, s) => sum + s, 0) / sentiments.length;
        return Math.max(-1, Math.min(1, avgSentiment));
    }
    computeHypeScore(articles) {
        if (!articles.length)
            return 0;
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        // Count recent articles
        const recentArticles = articles.filter(article => {
            const publishedAt = new Date(article.published_at);
            return publishedAt >= oneDayAgo;
        });
        // Score based on volume (0-100)
        return Math.min(100, recentArticles.length * 10);
    }
}
exports.MarketAuxAdapter = MarketAuxAdapter;
