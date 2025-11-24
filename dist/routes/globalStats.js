"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalStatsRoutes = globalStatsRoutes;
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const logger_1 = require("../utils/logger");
async function globalStatsRoutes(fastify) {
    // GET /api/global-stats - Get global stats
    fastify.get('/', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const stats = await firestoreAdapter_1.firestoreAdapter.getGlobalStats();
            // If no stats exist, return default structure
            if (!stats) {
                return {
                    totalUsers: 0,
                    totalTrades: 0,
                    activeEngines: 0,
                    activeHFT: 0,
                    totalVolume: 0,
                };
            }
            // Convert timestamps
            const result = { ...stats };
            if (result.updatedAt) {
                result.updatedAt = result.updatedAt.toDate().toISOString();
            }
            return result;
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting global stats');
            return reply.code(500).send({ error: err.message || 'Error fetching global stats' });
        }
    });
}
