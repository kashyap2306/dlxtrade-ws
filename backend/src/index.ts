import { onRequest } from 'firebase-functions/v2/https';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { logger } from './utils/logger';
import { initializeFirebaseAdmin } from './utils/firebase';

let appPromise: Promise<FastifyInstance> | null = null;

async function getApp(): Promise<FastifyInstance> {
	if (!appPromise) {
		appPromise = (async () => {
			initializeFirebaseAdmin();
			const app = await buildApp();
			await app.ready();
			logger.info('Fastify app is ready for Firebase Functions');
			return app;
		})();
	}
	return appPromise;
}

export const api = onRequest(
	{ region: 'us-central1' },
	async (req, res): Promise<void> => {
		const app = await getApp();
		app.server.emit('request', req, res);
	}
);
