import type { Server } from 'node:http';
import app from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';

let server: Server | undefined;

const start = async (): Promise<void> => {
  // Fail before accepting traffic rather than 500-ing the first request.
  await prisma.$connect();
  logger.info('Database connection established');

  server = app.listen(env.PORT, () => {
    logger.info(`MessMate API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });
};

/**
 * Stop taking new requests, let in-flight ones finish, then release the pool.
 * A hard exit here can tear down a month-close transaction mid-write.
 */
const shutdown = async (signal: string): Promise<void> => {
  logger.info(`${signal} received, shutting down gracefully`);

  const timer = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);
  timer.unref();

  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await prisma.$disconnect();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  process.exit(1);
});

start().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to start server');
  process.exit(1);
});
