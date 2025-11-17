"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.firebaseAuthMiddleware = firebaseAuthMiddleware;
const firebase_1 = require("../utils/firebase");
const errors_1 = require("../utils/errors");
const logger_1 = require("../utils/logger");
async function firebaseAuthMiddleware(request, reply) {
    try {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new errors_1.AuthenticationError('Missing or invalid authorization header');
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
            throw new errors_1.AuthenticationError('Invalid or expired token');
        }
    }
    catch (error) {
        if (error instanceof errors_1.AuthenticationError) {
            reply.code(401).send({ error: error.message });
        }
        else {
            logger_1.logger.error({ error }, 'Error in Firebase auth middleware');
            reply.code(401).send({ error: 'Authentication failed' });
        }
        throw error;
    }
}
