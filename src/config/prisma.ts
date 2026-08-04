import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { env } from './env.js';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

/**
 * Singleton: `tsx watch` re-imports modules on every change, and a fresh
 * PrismaClient per reload exhausts the database connection pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: env.isProduction ? ['error'] : ['error', 'warn'],
  });

if (!env.isProduction) {
  globalForPrisma.prisma = prisma;
}

/** Transaction client — services accept this so they compose inside `$transaction`. */
export type PrismaTransactionClient = Prisma.TransactionClient;

/** Either the root client or a transaction client. */
export type Db = PrismaClient | PrismaTransactionClient;
