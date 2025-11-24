"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.marketRoutes = marketRoutes;
const binanceAdapter_1 = require("../services/binanceAdapter");
const logger_1 = require("../utils/logger");
const fetchValidBinanceSymbols_1 = require("../scripts/fetchValidBinanceSymbols");
/**
 * Market Routes
 * Handles market data endpoints like top coins
 */
async function marketRoutes(fastify) {
    // GET /api/market/top-coins - Get top coins by market cap/volume
    fastify.get('/top-coins', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;
            // Use Binance public API (free, no setup required)
            try {
                const binanceAdapter = new binanceAdapter_1.BinanceAdapter();
                // Get valid symbols from cache and use top ones
                const validSymbols = await (0, fetchValidBinanceSymbols_1.getValidSymbols)();
                const usdtSymbols = validSymbols.filter(symbol => symbol.endsWith('USDT'));
                const popularSymbols = usdtSymbols.slice(0, limit);
                const coins = [];
                for (const symbol of popularSymbols) {
                    try {
                        const marketData = await binanceAdapter.getMarketData(symbol);
                        if (marketData.price && marketData.price > 0) {
                            coins.push({
                                symbol,
                                name: symbol.replace('USDT', ''),
                                price: marketData.price,
                                change24h: marketData.priceChangePercent24h || 0,
                                volume24h: marketData.volume24h || 0,
                            });
                        }
                    }
                    catch (err) {
                        logger_1.logger.debug({ err, symbol }, 'Error fetching market data for symbol');
                    }
                }
                // Sort by volume descending
                coins.sort((a, b) => b.volume24h - a.volume24h);
                return {
                    ok: true,
                    coins: coins.slice(0, limit),
                    total: coins.length,
                };
            }
            catch (err) {
                logger_1.logger.error({ err }, 'Error fetching top coins from Binance');
                // Return default coins on error
                const popularCoins = [
                    { symbol: 'BTCUSDT', name: 'Bitcoin', price: 0, change24h: 0, volume24h: 0 },
                    { symbol: 'ETHUSDT', name: 'Ethereum', price: 0, change24h: 0, volume24h: 0 },
                ];
                return reply.code(200).send({
                    ok: false,
                    error: err.message || 'Error fetching top coins',
                    coins: popularCoins,
                    total: popularCoins.length,
                });
            }
        }
        catch (error) {
            logger_1.logger.error({ error: error.message, uid: request.user?.uid }, 'Error in market/top-coins');
            // NEVER return 500 - always return 200 with error flag
            return reply.code(200).send({
                ok: false,
                error: error.message || 'Error fetching top coins',
                coins: [],
                total: 0,
            });
        }
    });
}
