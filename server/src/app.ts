import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import swaggerUi from 'swagger-ui-express';
import { pinoHttp } from 'pino-http';
import type { Redis } from 'ioredis';
import { env } from './config/env';
import { logger } from './config/logger';
import { buildOpenApi } from './docs/openapi';
import { allowedOrigins, errorHandler, notFoundHandler, requestId } from './middleware/core';
import { apiLimiter } from './middleware/rateLimit';
import { buildRouter } from './routes';

export interface AppDeps {
  /** Used by /api/ready. Optional so unit tests can run without Redis. */
  redis?: Redis;
}

export function createApp(deps: AppDeps = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      autoLogging: { ignore: (req) => req.url === '/api/health' || req.url === '/api/ready' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // Swagger UI needs inline scripts, so it gets its own relaxed CSP and is mounted before the strict global one.
  const spec = buildOpenApi();
  app.get('/api/docs.json', (_req, res) => res.json(spec));
  app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'OpsPilot AI API' }));

  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        // Requests with no Origin (curl, server-to-server) are allowed; browsers must match the allow-list.
        if (!origin || allowedOrigins().includes(origin)) return cb(null, true);
        cb(new Error('CORS_NOT_ALLOWED'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()) }));
  app.get('/api/ready', async (_req, res) => {
    const mongo = mongoose.connection.readyState === 1;
    let redis: boolean | null = null;
    if (deps.redis) {
      try {
        redis = (await deps.redis.ping()) === 'PONG';
      } catch {
        redis = false;
      }
    }
    const ok = mongo && redis !== false;
    res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'degraded', mongo, redis });
  });

  app.use('/api', apiLimiter, buildRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
