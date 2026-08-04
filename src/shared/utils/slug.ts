import { randomBytes } from 'node:crypto';

/**
 * Bangla mess names are common, so a transliteration-free slug would often be
 * empty — fall back to a random stem rather than colliding on "".
 */
export const slugify = (value: string): string => {
  const base = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return base || 'mess';
};

export const uniqueSlug = (value: string): string =>
  `${slugify(value)}-${randomBytes(3).toString('hex')}`;
