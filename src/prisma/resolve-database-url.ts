/**
 * Railway / Docker: sometimes the app is started with `node ...` and skips docker-entrypoint,
 * or the platform injects POSTGRES_* / DATABASE_PRIVATE_URL instead of DATABASE_URL.
 * Prisma's generated schema uses env("DATABASE_URL"), so we normalize here for Nest runtime.
 */
export function resolveDatabaseUrl(): string {
  const pick = (...candidates: (string | undefined)[]): string => {
    for (const c of candidates) {
      const v = c?.trim();
      if (v) return v;
    }
    return '';
  };

  let url = pick(
    process.env.DATABASE_URL,
    process.env.DATABASE_PUBLIC_URL,
    process.env.DATABASE_INTERNAL_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRESQL_URL,
    process.env.DATABASE_PRIVATE_URL,
    process.env.RAILWAY_DATABASE_URL,
  );

  if (!url) {
    const host = process.env.PGHOST?.trim();
    const user = process.env.PGUSER?.trim();
    const password = process.env.PGPASSWORD;
    const database = process.env.PGDATABASE?.trim();
    const port = process.env.PGPORT?.trim() || '5432';
    if (host && user && password !== undefined && database) {
      const u = encodeURIComponent(user);
      const p = encodeURIComponent(password);
      url = `postgresql://${u}:${p}@${host}:${port}/${database}`;
    }
  }

  // Railway sometimes injects a non-standard name whose value is still postgresql://...
  if (!url) {
    url = findPostgresUrlFromAnyEnv();
  }

  return url;
}

/** Last resort: any env value that looks like a Postgres connection string. */
function findPostgresUrlFromAnyEnv(): string {
  const entries = Object.entries(process.env).filter(
    ([, v]) => v && /^postgres(ql)?:\/\//i.test(v.trim()),
  );
  if (entries.length === 0) return '';
  const preferred = entries.find(([k]) =>
    /DATABASE|POSTGRES|RAILWAY|PG/i.test(k),
  );
  return (preferred ?? entries[0])[1]!.trim();
}

/** Log which DB-related env keys exist (names only — never values). For Railway debugging. */
export function logDatabaseEnvKeyPresence(): void {
  const keys = Object.keys(process.env)
    .filter(
      (k) =>
        /DATABASE|POSTGRES|PGHOST|PGUSER|PGPASSWORD|PGDATABASE|PGPORT|RAILWAY/i.test(
          k,
        ),
    )
    .sort();
  // eslint-disable-next-line no-console
  console.error(
    '[AQERA] DB-related env keys present:',
    keys.length ? keys.join(', ') : '(none — add DATABASE_URL or connect Postgres to this service)',
  );
}

export function assertDatasourceUrl(url: string): void {
  if (!url) {
    throw new Error(
      'DATABASE_URL is missing. Set DATABASE_URL (postgresql://...) on Railway, or POSTGRES_URL / DATABASE_PRIVATE_URL, or PGHOST+PGUSER+PGPASSWORD+PGDATABASE.',
    );
  }
  // PostgreSQL (prod / Railway) or SQLite file URL (local dev)
  if (
    /^postgres(ql)?:\/\//i.test(url) ||
    /^file:/i.test(url)
  ) {
    return;
  }
  throw new Error(
    `DATABASE_URL must be postgresql://..., postgres://..., or file:... (SQLite dev). Got: ${url.slice(0, 32)}...`,
  );
}
