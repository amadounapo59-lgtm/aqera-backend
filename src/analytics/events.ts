/**
 * Standardized event names for analytics. Use only these constants in logEvent.
 */
export const EventNames = {
  // AUTH
  auth_register_success: 'auth_register_success',
  auth_register_failed: 'auth_register_failed',
  auth_login_success: 'auth_login_success',
  auth_login_failed: 'auth_login_failed',
  auth_logout: 'auth_logout',
  auth_change_password_success: 'auth_change_password_success',
  auth_change_password_failed: 'auth_change_password_failed',
  // APP
  app_open: 'app_open',
  app_screen_view: 'app_screen_view',
  app_session_start: 'app_session_start',
  app_session_end: 'app_session_end',
  // MISSIONS
  mission_feed_view: 'mission_feed_view',
  mission_view: 'mission_view',
  mission_click_action_url: 'mission_click_action_url',
  mission_submit_success: 'mission_submit_success',
  mission_submit_failed: 'mission_submit_failed',
  mission_attempt_approved: 'mission_attempt_approved',
  mission_attempt_rejected: 'mission_attempt_rejected',
  // WALLET
  wallet_pending_added: 'wallet_pending_added',
  wallet_pending_released: 'wallet_pending_released',
  wallet_available_added: 'wallet_available_added',
  wallet_available_debited: 'wallet_available_debited',
  wallet_balance_view: 'wallet_balance_view',
  // GIFTCARDS
  giftcard_marketplace_view: 'giftcard_marketplace_view',
  giftcard_list_view: 'giftcard_list_view',
  giftcard_detail_view: 'giftcard_detail_view',
  giftcard_purchase_attempt: 'giftcard_purchase_attempt',
  giftcard_purchase_success: 'giftcard_purchase_success',
  giftcard_purchase_failed: 'giftcard_purchase_failed',
  giftcard_redeem_attempt: 'giftcard_redeem_attempt',
  giftcard_redeem_success: 'giftcard_redeem_success',
  giftcard_redeem_failed: 'giftcard_redeem_failed',
  giftcard_mark_used_success: 'giftcard_mark_used_success',
  // BRAND
  brand_apply_success: 'brand_apply_success',
  brand_apply_failed: 'brand_apply_failed',
  brand_profile_update_success: 'brand_profile_update_success',
  brand_mission_create_attempt: 'brand_mission_create_attempt',
  brand_mission_create_success: 'brand_mission_create_success',
  brand_mission_create_failed: 'brand_mission_create_failed',
  brand_campaign_create_attempt: 'brand_campaign_create_attempt',
  brand_campaign_create_success: 'brand_campaign_create_success',
  brand_campaign_create_failed: 'brand_campaign_create_failed',
  brand_budget_view: 'brand_budget_view',
  brand_stats_view: 'brand_stats_view',
  // ADMIN
  admin_attempts_list_view: 'admin_attempts_list_view',
  admin_attempt_approve_success: 'admin_attempt_approve_success',
  admin_attempt_reject_success: 'admin_attempt_reject_success',
  admin_brand_application_approve_success: 'admin_brand_application_approve_success',
  admin_brand_application_reject_success: 'admin_brand_application_reject_success',
  admin_agency_application_approve_success: 'admin_agency_application_approve_success',
  admin_agency_application_reject_success: 'admin_agency_application_reject_success',
  admin_platform_budget_view: 'admin_platform_budget_view',
  admin_daily_metrics_view: 'admin_daily_metrics_view',
  // PLATFORM
  platform_margin_earned: 'platform_margin_earned',
  platform_campaign_create_attempt: 'platform_campaign_create_attempt',
  platform_campaign_create_success: 'platform_campaign_create_success',
  platform_campaign_create_failed: 'platform_campaign_create_failed',
  platform_budget_debited: 'platform_budget_debited',
  // BILLING
  billing_checkout_session_created: 'billing_checkout_session_created',
  billing_subscription_activated: 'billing_subscription_activated',
  billing_subscription_canceled: 'billing_subscription_canceled',
  billing_payment_failed: 'billing_payment_failed',
  billing_webhook_received: 'billing_webhook_received',
} as const;

export type EventName = (typeof EventNames)[keyof typeof EventNames];

export const EntityTypes = {
  AUTH: 'AUTH',
  MISSION: 'MISSION',
  MISSION_ATTEMPT: 'MISSION_ATTEMPT',
  WALLET: 'WALLET',
  GIFT_CARD: 'GIFT_CARD',
  BRAND: 'BRAND',
  PLATFORM: 'PLATFORM',
  BILLING: 'BILLING',
} as const;

export type EntityType = (typeof EntityTypes)[keyof typeof EntityTypes];
