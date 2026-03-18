/**
 * Split array into chunks of at most `size` elements (for SQL IN clauses, etc.).
 * SQLite has ~999 max bind params; PostgreSQL is higher; 500 is a safe default.
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

export const IN_CLAUSE_CHUNK_SIZE = 500;
