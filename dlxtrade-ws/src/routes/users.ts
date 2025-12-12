console.log("[DEBUG] usersRoutes file EXECUTED");

import { FastifyInstance } from 'fastify';
import { providerConfigRoutes } from './users/providerConfig';
import { exchangeAndTradingRoutes } from './users/exchangeAndTrading';
import { coreUserRoutes } from './users/core';

export async function usersRoutes(fastify: FastifyInstance) {
  console.log("[CHECK] usersRoutes EXECUTED");

  // Register provider config routes first (moved to top in original)
  await providerConfigRoutes(fastify);

  // Register exchange and trading routes
  await exchangeAndTradingRoutes(fastify);

  // Register core user routes
  await coreUserRoutes(fastify);

  console.log("[ROUTE REGISTRATION COMPLETE] All user routes registered");
}

