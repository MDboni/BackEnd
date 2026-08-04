import type { ResponseMeta } from './sendResponse.js';

export type PaginationQuery = {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
};

export type PaginationOptions = {
  skip: number;
  take: number;
  page: number;
  limit: number;
  orderBy: Record<string, 'asc' | 'desc'>;
};

/**
 * `allowedSortFields` is a whitelist on purpose: passing a raw query value into
 * Prisma's `orderBy` would let a caller sort by (and probe) any column.
 */
export const buildPagination = (
  query: PaginationQuery,
  allowedSortFields: string[],
  defaultSortBy = 'createdAt',
): PaginationOptions => {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const sortBy =
    query.sortBy && allowedSortFields.includes(query.sortBy) ? query.sortBy : defaultSortBy;
  const sortOrder: 'asc' | 'desc' = query.sortOrder === 'asc' ? 'asc' : 'desc';

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { [sortBy]: sortOrder },
  };
};

export const buildMeta = (options: PaginationOptions, total: number): ResponseMeta => ({
  page: options.page,
  limit: options.limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / options.limit)),
});
