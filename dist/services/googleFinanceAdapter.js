"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleFinanceAdapter = exports.getExchangeRates = exports.googleFinanceAdapter = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const googleFinanceAdapter = {
    httpClient: null,
    lastKnownRate: 83.0, // Fallback rate if scraping fails
    lastFetchTime: 0,
    CACHE_DURATION: 5 * 60 * 1000, // 5 minutes cache
    initialize() {
        if (!this.httpClient) {
            this.httpClient = axios_1.default.create({
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
        }
    },
    /**
     * Get USD to INR exchange rate from Google Finance - replaces CoinAPI exchange rate
     */
    async getExchangeRate(baseCurrency = 'USD', quoteCurrency = 'INR') {
        this.initialize();
        try {
            // Use cached rate if recent enough
            const now = Date.now();
            if (now - this.lastFetchTime < this.CACHE_DURATION) {
                return { exchangeRate: this.lastKnownRate };
            }
            // Google Finance URL for USD/INR
            const url = 'https://www.google.com/finance/quote/USD-INR';
            const response = await this.httpClient.get(url);
            const html = response.data;
            // Parse the exchange rate from HTML
            // Look for the rate in the page content
            const rate = await this.parseExchangeRateFromHTML(html);
            if (rate && rate > 0) {
                this.lastKnownRate = rate;
                this.lastFetchTime = now;
                logger_1.logger.info({ rate, baseCurrency, quoteCurrency }, 'Successfully fetched USD/INR rate');
                return { exchangeRate: rate };
            }
            else {
                // Fallback to last known rate
                logger_1.logger.warn({ baseCurrency, quoteCurrency }, 'Failed to get exchange rate, using cached rate');
                return { exchangeRate: this.lastKnownRate };
            }
        }
        catch (error) {
            logger_1.logger.warn({
                error: error.message,
                baseCurrency,
                quoteCurrency,
                lastKnownRate: this.lastKnownRate
            }, 'Google Finance exchange rate fetch failed, using cached rate');
            return { exchangeRate: this.lastKnownRate };
        }
    },
    async parseExchangeRateFromHTML(html) {
        try {
            // Look for exchange rate in various formats
            // Google Finance typically shows rates like "83.45" or similar
            const patterns = [
                /"rate":\s*"([^"]+)"/,
                /data-last-price="([^"]+)"/,
                /class="[^"]*rate[^"]*"[^>]*>([^<]+)</,
                /([0-9]+\.[0-9]{2,4})/
            ];
            for (const pattern of patterns) {
                const match = html.match(pattern);
                if (match && match[1]) {
                    const rate = parseFloat(match[1]);
                    if (rate > 50 && rate < 150) { // Reasonable range for USD/INR
                        return rate;
                    }
                }
            }
            logger_1.logger.warn('Could not parse exchange rate from Google Finance HTML');
            return null;
        }
        catch (error) {
            logger_1.logger.error({ error: error.message }, 'Error parsing Google Finance HTML');
            return null;
        }
    },
    async getExchangeRates(baseCurrency = 'USD', quoteCurrency = 'INR') {
        return this.getExchangeRate(baseCurrency, quoteCurrency);
    }
};
exports.googleFinanceAdapter = googleFinanceAdapter;
exports.getExchangeRates = googleFinanceAdapter.getExchangeRates.bind(googleFinanceAdapter);
exports.GoogleFinanceAdapter = googleFinanceAdapter;
