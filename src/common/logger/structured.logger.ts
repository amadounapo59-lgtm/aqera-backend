/**
 * Structured JSON logger for observability (one JSON object per line).
 * Use in filters and security events so log aggregators can parse.
 */
const LOG_LEVEL = (process.env.LOG_LEVEL ?? 'info').toLowerCase();

function shouldLog(level: string): boolean {
  const order = ['debug', 'info', 'warn', 'error'];
  return order.indexOf(level) >= order.indexOf(LOG_LEVEL);
}

function write(level: string, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  });
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const structuredLog = {
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => write('debug', message, meta),
};
