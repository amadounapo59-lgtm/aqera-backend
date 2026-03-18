/**
 * Pilot security config from env (defaults for dev).
 */
export const securityConfig = {
  rateLimitEnabled: process.env.SECURITY_RATE_LIMIT_ENABLED !== 'false',
  registerPerIpPerHour: parseInt(process.env.SECURITY_REGISTER_PER_IP_PER_HOUR ?? '5', 10) || 5,
  loginPerIpPer15Min: parseInt(process.env.SECURITY_LOGIN_PER_IP_PER_15MIN ?? '20', 10) || 20,
  submitPerUserPerHour: parseInt(process.env.SECURITY_SUBMIT_PER_USER_PER_HOUR ?? '40', 10) || 40,
  redeemPerStaffPer15Min: parseInt(process.env.SECURITY_REDEEM_PER_STAFF_PER_15MIN ?? '60', 10) || 60,
  purchasePerUserPerDay: parseInt(process.env.SECURITY_PURCHASE_PER_USER_PER_DAY ?? '10', 10) || 10,
  /** Exiger email vérifié pour acheter des cartes. Désactivé par défaut (achat autorisé sans vérification). */
  requireEmailVerifiedForPurchase: process.env.SECURITY_REQUIRE_EMAIL_VERIFIED_FOR_PURCHASE === 'true',
  /** Bloquer l’inscription avec un domaine d’email jetable (tempmail, guerrillamail, etc.). */
  blockDisposableEmailDomains: process.env.SECURITY_BLOCK_DISPOSABLE_EMAIL !== 'false',
  deviceHeader: (process.env.SECURITY_DEVICE_HEADER ?? 'x-device-id').toLowerCase(),
  auditLogEnabled: process.env.SECURITY_AUDIT_LOG_ENABLED !== 'false',
} as const;

export type SecurityContext = { ip: string; deviceId: string };
