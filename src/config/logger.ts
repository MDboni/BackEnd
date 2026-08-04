import pino from 'pino';
import { env } from './env.js';

/**
 * Blueprint 8.3: structured logging. Credentials and tokens are redacted at the
 * logger, not at each call site, so a new route cannot leak them by accident.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.currentPassword',
      '*.newPassword',
      '*.accessToken',
      '*.refreshToken',
      '*.token',
      '*.code',
    ],
    censor: '[redacted]',
  },
  ...(env.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});
