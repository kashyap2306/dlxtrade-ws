import { onRequest } from 'firebase-functions/v2/https';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { logger } from './utils/logger';

let appPromise: Promise<FastifyInstance> | null = null;

async function getApp(): Promise<FastifyInstance> {
	if (!appPromise) {
		appPromise = (async () => {
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
		// Delegate the HTTP request to Fastify's internal server
		app.server.emit('request', req, res);
	}
);

import * as functions from 'firebase-functions';
import { buildApp } from './app';
import { initializeFirebaseAdmin } from './utils/firebase';

let appPromise: Promise<import('fastify').FastifyInstance> | null = null;

async function getFastify() {
  if (!appPromise) {
    appPromise = (async () => {
      // Ensure Firebase Admin is initialized on cold start
      initializeFirebaseAdmin();
      const app = await buildApp();
      await app.ready();
      return app;
    })();
  }
  return appPromise;
}

export const api = functions.https.onRequest(async (req, res) => {
  const app = await getFastify();
  app.server.emit('request', req, res);
});


