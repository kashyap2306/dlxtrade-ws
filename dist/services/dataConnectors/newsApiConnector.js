"use strict";
/**
 * News API Connector
 * Fetches crypto news headlines and computes sentiment
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NewsApiConnector = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../../utils/logger");
const apiUsageTracker_1 = require("../apiUsageTracker");
class NewsApiConnector {
    constructor(apiKey) {
        this.baseUrl = 'https://newsapi.org/v2';
        this.apiKey = apiKey;
        this.httpClient = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: 10000,
            params: this.apiKey ? {
                apiKey: this.apiKey,
            } : {},
        });
    }
    /**
     * Simple sentiment analysis (keyword-based)
     */
    analyzeSentiment(text) {
        const lowerText = text.toLowerCase();
        // Positive keywords
        const positiveKeywords = ['bullish', 'surge', 'rally', 'gain', 'up', 'rise', 'breakthrough', 'pump', 'moon'];
        // Negative keywords
        const negativeKeywords = ['bearish', 'crash', 'drop', 'fall', 'down', 'decline', 'dump', 'crash', 'bear'];
        let positiveCount = 0;
        let negativeCount = 0;
        positiveKeywords.forEach(keyword => {
            const matches = (lowerText.match(new RegExp(keyword, 'g')) || []).length;
            positiveCount += matches;
        });
        negativeKeywords.forEach(keyword => {
            const matches = (lowerText.match(new RegExp(keyword, 'g')) || []).length;
            negativeCount += matches;
        });
        const total = positiveCount + negativeCount;
        if (total === 0)
            return 0;
        // Return sentiment from -1 to 1
        return (positiveCount - negativeCount) / total;
    }
    /**
     * Get crypto news for a symbol
     */
    async getCryptoNews(symbol, limit = 10) {
        try {
            const baseSymbol = symbol.replace('USDT', '').replace('USD', '');
            const query = `${baseSymbol} OR bitcoin OR cryptocurrency OR crypto`;
            const response = await this.httpClient.get('/everything', {
                params: {
                    q: query,
                    sortBy: 'publishedAt',
                    language: 'en',
                    pageSize: limit,
                },
            });
            apiUsageTracker_1.apiUsageTracker.increment('newsapi');
            const articles = response.data?.articles || [];
            const headlines = articles.map((article) => ({
                title: article.title || '',
                description: article.description || '',
                url: article.url || '',
                publishedAt: article.publishedAt || '',
                source: article.source?.name || 'Unknown',
            }));
            // Compute sentiment from headlines
            const allText = headlines.map(h => `${h.title} ${h.description}`).join(' ');
            const sentiment = this.analyzeSentiment(allText);
            const sentimentScore = ((sentiment + 1) / 2) * 100; // Convert to 0-100 scale
            return {
                headlines,
                sentiment,
                sentimentScore,
                mentionCount: headlines.length,
                timestamp: Date.now(),
            };
        }
        catch (error) {
            logger_1.logger.warn({ error: error.message, symbol }, 'News API fetch failed');
            return {
                headlines: [],
                sentiment: 0,
                sentimentScore: 50,
                mentionCount: 0,
                timestamp: Date.now(),
            };
        }
    }
}
exports.NewsApiConnector = NewsApiConnector;
