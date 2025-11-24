"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uiPreferencesRoutes = uiPreferencesRoutes;
const zod_1 = require("zod");
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const logger_1 = require("../utils/logger");
const updatePreferencesSchema = zod_1.z.object({
    dismissedAgents: zod_1.z.array(zod_1.z.string()).optional(),
    hideDashboardCard: zod_1.z.array(zod_1.z.string()).optional(),
    theme: zod_1.z.enum(['light', 'dark']).optional(),
    sidebarPinned: zod_1.z.boolean().optional(),
});
async function uiPreferencesRoutes(fastify) {
    // GET /api/ui-preferences - Get user UI preferences
    fastify.get('/', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const preferences = await firestoreAdapter_1.firestoreAdapter.getUserUIPreferences(user.uid);
            return { preferences: preferences || {} };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting UI preferences');
            return reply.code(500).send({ error: err.message || 'Error fetching UI preferences' });
        }
    });
    // POST /api/ui-preferences/update - Update UI preferences
    fastify.post('/update', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const body = updatePreferencesSchema.parse(request.body);
            await firestoreAdapter_1.firestoreAdapter.updateUIPreferences(user.uid, body);
            return { message: 'UI preferences updated successfully' };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error updating UI preferences');
            return reply.code(500).send({ error: err.message || 'Error updating UI preferences' });
        }
    });
}
