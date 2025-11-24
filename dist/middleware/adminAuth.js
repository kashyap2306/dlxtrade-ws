"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminAuthMiddleware = adminAuthMiddleware;
const firebase_1 = require("../utils/firebase");
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
async function adminAuthMiddleware(request, reply) {
    try {
        const user = request.user;
        if (!user || !user.uid) {
            throw new errors_1.AuthorizationError('User not authenticated');
        }
        // Check admin via Firestore root-only flags
        const db = (0, firebase_1.getFirebaseAdmin)().firestore();
        const snapshot = await db.collection('users').doc(user.uid).get();
        if (!snapshot.exists) {
            throw new errors_1.AuthorizationError('User doc missing');
        }
        const userData = snapshot.data() || {};
        const roleRoot = userData.role;
        const isAdminRoot = userData.isAdmin === true;
        const hasAdmin = roleRoot === 'admin' || isAdminRoot;
        if (!hasAdmin) {
            logger_1.logger.warn({ uid: user.uid, roleRoot, isAdminRoot }, 'Non-admin user attempted to access admin route');
            throw new errors_1.AuthorizationError('Access Denied');
        }
        logger_1.logger.debug({ uid: user.uid }, 'Admin access granted');
    }
    catch (error) {
        if (error instanceof errors_1.AuthorizationError) {
            reply.code(403).send({ error: error.message });
        }
        else {
            logger_1.logger.error({ error }, 'Error in admin auth middleware');
            reply.code(403).send({ error: 'Admin authorization failed' });
        }
        throw error;
    }
}
