import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Application, type Request, type Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { globalErrorHandler } from './middlewares/globalErrorHandler.js';
import { notFound } from './middlewares/notFound.js';
import { globalLimiter } from './middlewares/rateLimit.js';
import { apiRoutes } from './routes/index.js';
import { ForbiddenError } from './shared/errors/AppError.js';

const app: Application = express();

// Behind Render/Railway/Vercel proxies `req.ip` and secure cookies need this.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet());

app.use(
  cors({
    // Blueprint 6.3: exact origins only, because credentials are sent.
    origin: (origin, callback) => {
      if (!origin || env.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // A plain Error here would surface as a 500 and be logged as a server
      // fault. A blocked origin is a client problem: answer 403 and log it at
      // warn level, so a misconfigured frontend is visible without paging.
      callback(new ForbiddenError(`Origin ${origin} is not allowed`));
    },
    credentials: true,
  }),
);

app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

/** One id per request, echoed in errors so a user report maps to a log line. */
app.use((req, _res, next) => {
  req.requestId = req.get('x-request-id') ?? randomUUID();
  next();
});

app.use(
  pinoHttp({
    logger,
    genReqId: (req) => (req as Request).requestId ?? randomUUID(),
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
  }),
);

app.use(globalLimiter);

/* --------------------------------- Health --------------------------------- */

app.get('/health/live', (_req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

/** Readiness actually touches the database — a pod with no DB is not ready. */
app.get('/health/ready', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', database: 'connected' });
  } catch (error) {
    logger.error({ err: error }, 'Readiness check failed');
    res.status(503).json({ status: 'unavailable', database: 'disconnected' });
  }
});

app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'MessMate API',
    version: 'v1',
    docs: '/api/v1',
    health: '/health/ready',
  });
});

app.use('/api/v1', apiRoutes);

app.use(notFound);
app.use(globalErrorHandler);

export default app;
