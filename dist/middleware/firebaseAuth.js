"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.firebaseAuthMiddleware = firebaseAuthMiddleware;
const firebase_1 = require("../utils/firebase");
const logger_1 = require("../utils/logger");
async function firebaseAuthMiddleware(request, reply) {
    try {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            reply.code(401).send({ error: 'Missing or invalid authorization header' });
            return; // Don't throw, just return after sending response
        }
        const token = authHeader.substring(7); // Remove 'Bearer ' prefix
        try {
            const decodedToken = await (0, firebase_1.verifyFirebaseToken)(token);
            // Attach user info + claims to request
            request.user = {
                uid: decodedToken.uid,
                email: decodedToken.email,
                emailVerified: decodedToken.email_verified,
                claims: decodedToken, // contains custom claims (e.g., role, isAdmin)
            };
            logger_1.logger.debug({ uid: decodedToken.uid }, 'Firebase token verified');
        }
        catch (error) {
            logger_1.logger.warn({ error: error.message }, 'Firebase token verification failed');
            reply.code(401).send({ error: 'Invalid or expired token' });
            return; // Don't throw, just return after sending response
        }
    }
    catch (error) {
        // Catch any unexpected errors
        logger_1.logger.error({ error, stack: error?.stack }, 'Unexpected error in Firebase auth middleware');
        reply.code(401).send({ error: 'Authentication failed' });
        return; // Don't throw, just return after sending response
    }
}
