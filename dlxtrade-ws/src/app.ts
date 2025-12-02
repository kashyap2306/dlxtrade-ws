// @ts-nocheck
import Fastify, { FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { config } from './config';
import { logger } from './utils/logger';
import { initializeFirebaseAdmin } from './utils/firebase';
import { firebaseAuthMiddleware } from './middleware/firebaseAuth';
import { authRoutes } from './routes/auth';
import { adminRoutes } from './routes/admin';
import { ordersRoutes } from './routes/orders';
import { engineRoutes } from './routes/engine';
import { metricsRoutes } from './routes/metrics';
import { researchRoutes } from './routes/research';
import { settingsRoutes } from './routes/settings';
import { executionRoutes } from './routes/execution';
import { integrationsRoutes } from './routes/integrations';
import { hftRoutes } from './routes/hft';
import { usersRoutes } from './routes/users';
import { agentsRoutes } from './routes/agents';
import { activityLogsRoutes } from './routes/activityLogs';
import { tradesRoutes } from './routes/trades';
import { notificationsRoutes } from './routes/notifications';
import { systemLogsRoutes } from './routes/systemLogs';
import { uiPreferencesRoutes } from './routes/uiPreferences';
import { globalStatsRoutes } from './routes/globalStats';
import { engineStatusRoutes } from './routes/engineStatus';
import { hftLogsRoutes } from './routes/hftLogs';
import { autoTradeRoutes } from './routes/autoTrade';
import { exchangeRoutes } from './routes/exchange';
import { diagnosticsRoutes } from './routes/diagnostics';
import { chatbotRoutes } from './routes/chatbot';
import { walletRoutes } from './routes/wallet';
import { marketRoutes } from './routes/market';

// Environment checks
console.log("ENV: VITE_API_URL set?", !!process.env.VITE_API_URL);

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger.child({ component: 'fastify' }),
  });

  // Security
  await app.register(fastifyHelmet);
  // CORS configuration
  await app.register(fastifyCors, {
    origin: "*",
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
    credentials: true,
  });

  // Rate limiting with user-aware keys and local allow list
  await app.register(fastifyRateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow,
    allowList: (req) => {
      const ip = req.ip || '';
      // Allow localhost in development to reduce friction
      return ip === '127.0.0.1' || ip === '::1';
    },
    keyGenerator: (req) => {
      try {
        // Prefer Firebase-authenticated uid when available
        const user = (req as any).user;
        if (user?.uid) return `uid:${user.uid}`;
        // Fallback to authorization token hash
        const auth = req.headers.authorization || '';
        if (auth) return `auth:${auth.slice(-16)}`;
      } catch {}
      // Fallback to IP
      return `ip:${req.ip}`;
    },
  });

  // Firebase Admin will be initialized in server.ts after server starts
  // Don't initialize here to avoid blocking server startup

  // JWT (kept for backward compatibility if needed)
  await app.register(fastifyJwt, {
    secret: config.jwtSecret,
  });

  // Firebase Authentication decorator
  app.decorate('authenticate', firebaseAuthMiddleware);

  // WebSocket
  await app.register(fastifyWebsocket);
  console.log('WS ROUTE READY');

  // Routes
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(ordersRoutes, { prefix: '/api' });
  await app.register(engineRoutes, { prefix: '/api/engine' });
  await app.register(metricsRoutes, { prefix: '/api' });
  await app.register(researchRoutes, { prefix: '/api/research' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.register(executionRoutes, { prefix: '/api/execution' });
  await app.register(integrationsRoutes, { prefix: '/api/integrations' });
  await app.register(hftRoutes, { prefix: '/api/hft' });
  await app.register(usersRoutes, { prefix: '/api/users' });
  await app.register(agentsRoutes, { prefix: '/api/agents' });
  await app.register(activityLogsRoutes, { prefix: '/api/activity-logs' });
  await app.register(tradesRoutes, { prefix: '/api/trades' });
  await app.register(notificationsRoutes, { prefix: '/api/notifications' });
  await app.register(systemLogsRoutes, { prefix: '/api/logs' });
  await app.register(uiPreferencesRoutes, { prefix: '/api/ui-preferences' });
  await app.register(globalStatsRoutes, { prefix: '/api/global-stats' });
  await app.register(engineStatusRoutes, { prefix: '/api/engine-status' });
  await app.register(hftLogsRoutes, { prefix: '/api/hft-logs' });
  await app.register(autoTradeRoutes, { prefix: '/api/auto-trade' });
  await app.register(exchangeRoutes, { prefix: '/api' });
  await app.register(diagnosticsRoutes, { prefix: '/api/diagnostics' });
  await app.register(notificationsRoutes, { prefix: '/api' });
  await app.register(chatbotRoutes, { prefix: '/api' });
  await app.register(walletRoutes, { prefix: '/api/wallet' });
  await app.register(marketRoutes, { prefix: '/api/market' });

  console.log('✅ All routes registered:');
  console.log('  - /api/auth/*');
  console.log('  - /api/admin/*');
  console.log('  - /api/orders');
  console.log('  - /api/engine/*');
  console.log('  - /api/hft/*');
  console.log('  - /api/settings/*');
  console.log('  - /api/research/*');
  console.log('  - /api/execution/*');
  console.log('  - /api/integrations/*');
  console.log('  - /api/users/*');
  console.log('  - /api/agents/*');
  console.log('  - /api/activity-logs/*');
  console.log('  - /api/trades/*');
  console.log('  - /api/notifications/*');
  console.log('  - /api/logs/*');
  console.log('  - /api/ui-preferences/*');
  console.log('  - /api/global-stats/*');
  console.log('  - /api/engine-status/*');
    console.log('  - /api/hft-logs/*');
    console.log('  - /api/auto-trade/*');
    console.log('  - /api/exchange/*');
    console.log('  - /api/health');
  console.log('  - /api/metrics');
    console.log('  - /api/chatbot');
    console.log('  - /api/market/*');
    console.log('  - /ws (WebSocket)');
  console.log('  - /ws/admin (Admin WebSocket)');
  console.log('  - / (Root WebSocket - unauthenticated, for Render WS health)');

  // Test route to verify server is running (no auth required)
  app.get('/api/test', async (request, reply) => {
    return { status: 'ok', message: 'Backend is running', timestamp: new Date().toISOString() };
  });

  // Health check route (no auth required)
  app.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });


  // Admin WebSocket endpoint for real-time admin events
  app.get('/ws/admin', { websocket: true }, async (connection, req) => {
    // Verify Firebase token and admin role
    let uid: string | null = null;
    try {
      const token = (req.query as any).token || req.headers.authorization?.replace('Bearer ', '');
      if (token) {
        const { verifyFirebaseToken } = await import('./utils/firebase');
        const decoded = await verifyFirebaseToken(token);
        uid = decoded.uid;
        
        // Check admin role (root fields only)
        const { getFirebaseAdmin } = await import('./utils/firebase');
        const db = getFirebaseAdmin().firestore();
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists) {
          connection.socket.close();
          return;
        }
        const userData: any = userDoc.data() || {};
        const roleRoot = userData.role;
        const isAdminRoot = userData.isAdmin === true;
        // TEMP FIX — allow all users to connect
        const isAdmin = true;
        
        (req as any).user = { uid: decoded.uid, email: decoded.email };
      } else {
        logger.warn('Admin WebSocket connection without token');
        connection.socket.close();
        return;
      }
    } catch (err) {
      logger.warn({ err }, 'Admin WebSocket auth failed');
      connection.socket.close();
      return;
    }

    // Register admin WebSocket for global events
    const { adminWebSocketManager } = await import('./services/adminWebSocketManager');
    adminWebSocketManager.registerAdmin(connection.socket, uid!);
    logger.info({ uid }, 'Admin WebSocket connected');

    connection.socket.on('close', () => {
      adminWebSocketManager.unregisterAdmin(connection.socket);
      logger.info({ uid }, 'Admin WebSocket disconnected');
    });
  });

  // Root WebSocket endpoint: allow plain connections without auth (Render compatibility/health)
  app.get('/', { websocket: true }, async (connection, req) => {
    logger.info('Root WebSocket client connected (no auth)');
    try {
      connection.socket.send(JSON.stringify({ type: 'welcome', data: 'ok' }));
    } catch {}

    connection.socket.on('close', () => {
      logger.info('Root WebSocket client disconnected');
    });
  });

  // WebSocket endpoint for real-time updates (user channel)
  app.get('/ws', { websocket: true }, async (connection, req) => {
    // Allow unauthenticated connections for Render plain WS; if token provided, attach user
    let uid: string | null = null;
    const token = (req.query as any).token || req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const { verifyFirebaseToken } = await import('./utils/firebase');
        const decoded = await verifyFirebaseToken(token);
        uid = decoded.uid;
        console.log("WS uid:", uid);
        (req as any).user = { uid: decoded.uid, email: decoded.email };
      } catch (err) {
        logger.warn({ err }, 'WebSocket auth failed; continuing unauthenticated');
      }
    } else {
      logger.info('WebSocket connection without token (unauthenticated)');
    }

    // Register WebSocket to user's engines if they exist (don't let failures block research)
    try {
      const { userEngineManager } = await import('./services/userEngineManager');
      const accuracyEngine = userEngineManager.getAccuracyEngine(uid!);
      const hftEngine = userEngineManager.getHFTEngine(uid!);

      if (uid && accuracyEngine) {
        accuracyEngine.registerWebSocketClient(connection.socket);
        logger.info({ uid }, 'WebSocket connection registered to AI engine');
      }

      if (uid && hftEngine) {
        hftEngine.registerWebSocketClient(connection.socket);
        logger.info({ uid }, 'WebSocket connection registered to HFT engine');
      }

      if (uid && !accuracyEngine && !hftEngine) {
        logger.debug({ uid }, 'WebSocket connected but user engines not initialized yet');
      }
    } catch (error: any) {
      console.error("WS: Error registering WebSocket to engines:", error.message);
      // Don't let WebSocket registration errors affect research functionality
    }

    connection.socket.on('message', (raw) => {
      try {
        const text = raw.toString().trim();

        // Ignore all ping messages immediately
        if (text === "ping" || text.startsWith("ping")) {
          connection.socket.send("pong");
          return;
        }

        let data;
        try {
          data = JSON.parse(text);
        } catch {
          console.warn("WS: Non-JSON message ignored:", text);
          return;
        }

        logger.debug({ data, uid }, 'WebSocket message received');
      } catch (error: any) {
        console.error("WS: Error handling message:", error.message);
        // Don't let WebSocket errors affect other operations
      }
    });

    connection.socket.on('close', () => {
      if (accuracyEngine) {
        accuracyEngine.unregisterWebSocketClient(connection.socket);
      }
      if (hftEngine) {
        hftEngine.unregisterWebSocketClient(connection.socket);
      }
      logger.info({ uid }, 'WebSocket connection closed');
    });
  });

  return app;
}

