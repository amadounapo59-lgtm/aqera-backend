import * as crypto from 'crypto';

export type RequestContext = {
  source?: 'mobile' | 'web_brand' | 'web_admin';
  ipHash?: string;
  userAgent?: string;
  deviceId?: string;
  clientTimestamp?: number;
};

const SOURCE_HEADER = 'x-aqera-source';
const DEVICE_ID_HEADER = 'x-device-id';

export function getRequestContext(req: { headers?: Record<string, string | string[] | undefined>; ip?: string }): RequestContext {
  const headers = req?.headers ?? {};
  const get = (key: string): string | undefined => {
    const v = headers[key.toLowerCase()];
    return Array.isArray(v) ? v[0] : (v as string | undefined);
  };

  const sourceRaw = get(SOURCE_HEADER);
  const source =
    sourceRaw === 'mobile' || sourceRaw === 'web_brand' || sourceRaw === 'web_admin' ? sourceRaw : undefined;

  let ipHash: string | undefined;
  if (req?.ip) {
    ipHash = crypto.createHash('sha256').update(req.ip).digest('hex').slice(0, 16);
  }

  const userAgent = get('user-agent');
  const deviceId = get(DEVICE_ID_HEADER);
  const clientTimestampRaw = get('x-client-timestamp');
  const clientTimestamp = clientTimestampRaw ? parseInt(clientTimestampRaw, 10) : undefined;

  return {
    source,
    ipHash,
    userAgent,
    deviceId,
    clientTimestamp: Number.isFinite(clientTimestamp) ? clientTimestamp : undefined,
  };
}

/** Merge request context into metadata (for logEvent). */
export function mergeContextIntoMetadata(
  metadata: Record<string, unknown> | undefined,
  ctx: RequestContext,
): Record<string, unknown> {
  const out = { ...(metadata ?? {}) };
  if (ctx.source) out.source = ctx.source;
  if (ctx.ipHash) out.ip_hash = ctx.ipHash;
  if (ctx.userAgent) out.user_agent = ctx.userAgent;
  if (ctx.deviceId) out.device_id = ctx.deviceId;
  if (ctx.clientTimestamp != null) out.client_timestamp = ctx.clientTimestamp;
  return out;
}
