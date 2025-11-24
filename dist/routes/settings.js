"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.settingsRoutes = settingsRoutes;
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const zod_1 = require("zod");
const settingsSchema = zod_1.z.object({
    symbol: zod_1.z.string().optional(),
    quoteSize: zod_1.z.number().positive().optional(),
    adversePct: zod_1.z.number().min(0).max(1).optional(),
    cancelMs: zod_1.z.number().int().positive().optional(),
    maxPos: zod_1.z.number().positive().optional(),
    minAccuracyThreshold: zod_1.z.number().min(0).max(1).optional(),
    autoTradeEnabled: zod_1.z.boolean().optional(),
    strategy: zod_1.z.enum(['orderbook_imbalance', 'smc_hybrid', 'stat_arb']).optional(), // market_making_hft is handled by HFT engine
    liveMode: zod_1.z.boolean().optional(),
    max_loss_pct: zod_1.z.number().min(0).max(100).optional(),
    max_drawdown_pct: zod_1.z.number().min(0).max(100).optional(),
    per_trade_risk_pct: zod_1.z.number().min(0).max(100).optional(),
    status: zod_1.z.enum(['active', 'paused_by_risk', 'paused_manual']).optional(),
});
async function settingsRoutes(fastify) {
    // Load user settings
    fastify.get('/load', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const settings = await firestoreAdapter_1.firestoreAdapter.getSettings(user.uid);
        if (!settings) {
            return {
                symbol: 'BTCUSDT',
                quoteSize: 0.001,
                adversePct: 0.0002,
                cancelMs: 40,
                maxPos: 0.01,
                minAccuracyThreshold: 0.85,
                autoTradeEnabled: false,
                strategy: 'orderbook_imbalance',
                liveMode: false,
                max_loss_pct: 5,
                max_drawdown_pct: 10,
                per_trade_risk_pct: 1,
                status: 'active',
            };
        }
        return {
            ...settings,
            updatedAt: settings.updatedAt?.toDate().toISOString(),
        };
    });
    // Update user settings
    fastify.post('/update', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const body = settingsSchema.parse(request.body);
        // Safety check: Block liveMode if ENABLE_LIVE_TRADES is not set
        if (body.liveMode === true) {
            const enableLiveTrades = process.env.ENABLE_LIVE_TRADES === 'true';
            if (!enableLiveTrades) {
                return reply.code(403).send({
                    error: 'Live trading is disabled globally. Set ENABLE_LIVE_TRADES=true in environment to enable.'
                });
            }
        }
        await firestoreAdapter_1.firestoreAdapter.saveSettings(user.uid, body);
        return { message: 'Settings updated', settings: body };
    });
    // Load global settings (admin only)
    fastify.get('/global/load', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const isAdmin = await firestoreAdapter_1.firestoreAdapter.isAdmin(user.uid);
            if (!isAdmin) {
                return reply.code(403).send({ error: 'Admin access required' });
            }
            const settings = await firestoreAdapter_1.firestoreAdapter.getGlobalSettings();
            return { settings: settings || {} };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message || 'Error loading global settings' });
        }
    });
    // Update global settings (admin only)
    fastify.post('/global/update', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const isAdmin = await firestoreAdapter_1.firestoreAdapter.isAdmin(user.uid);
            if (!isAdmin) {
                return reply.code(403).send({ error: 'Admin access required' });
            }
            const body = request.body;
            await firestoreAdapter_1.firestoreAdapter.updateGlobalSettings(body);
            return { message: 'Global settings updated successfully' };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message || 'Error updating global settings' });
        }
    });
}
