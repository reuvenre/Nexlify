import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import type {
  User,
  AuthResponse,
  OptimizerAction,
  CredentialSet,
  CredentialSetInput,
  Campaign,
  CampaignRunResult,
  CampaignInput,
  AliProduct,
  AliCategory,
  Post,
  PostPreview,
  PostTemplate,
  EarningsSummary,
  OverviewStats,
  Earning,
  Channel,
  CreateChannelInput,
  UpdateChannelInput,
  PaginatedResponse,
  ApiError,
  CatalogProduct,
  CatalogStats,
  ResyncJob,
  CatalogStatus,
  VerifyResult,
  HuntResult,
  ValidateResult,
  AdminUser,
  AdminStats,
  Coupon,
  ParsedCoupon,
  BroadcastResult,
  NotificationPrefs,
  SubscriptionStatus,
  PlanDef,
  CreditPack,
  Promotion,
  ActiveDeal,
  SecurityEvent,
  BillingCycle,
  SupplierCatalog,
  SupplierProduct,
  BulkLinkResult,
  StoreMeta,
  StorePage,
  StoreProduct,
  StoreQuery,
  StorefrontSettings,
  AiUsageSummary,
  CustomPost,
  CustomPostInput,
} from '@/types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/** Wrap a Yupoo image URL in the backend proxy (Yupoo hotlink-blocks direct loads). */
export const yupooImg = (url?: string): string => {
  if (!url) return '';
  if (!/yupoo\.com/i.test(url)) return url;
  return `${BASE_URL.replace(/\/$/, '')}/suppliers/image?url=${encodeURIComponent(url)}`;
};

// ─── Axios instance ──────────────────────────────────────────────────────────

const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // sends HttpOnly refresh-token cookie automatically
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

// ─── Token management ─────────────────────────────────────────────────────────
// Persisted in localStorage so the session survives page reloads even when the API
// lives on a different domain than the app — there the HttpOnly refresh cookie is a
// third-party cookie and browsers block it. The refresh token is sent back to
// /auth/refresh via the x-refresh-token header.

const ACCESS_KEY = 'nx_access_token';
const REFRESH_KEY = 'nx_refresh_token';
const ls = (): Storage | null => (typeof window !== 'undefined' ? window.localStorage : null);

let accessToken: string | null = ls()?.getItem(ACCESS_KEY) ?? null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
  if (token) ls()?.setItem(ACCESS_KEY, token);
  else ls()?.removeItem(ACCESS_KEY);
};

export const setRefreshToken = (token: string | null) => {
  if (token) ls()?.setItem(REFRESH_KEY, token);
  else ls()?.removeItem(REFRESH_KEY);
};

const getRefreshToken = (): string | null => ls()?.getItem(REFRESH_KEY) ?? null;

// ─── Request interceptor: inject Bearer token ────────────────────────────────

http.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// ─── Response interceptor: silent token refresh on 401 ──────────────────────

let refreshing = false;
let queue: Array<{ resolve: (t: string) => void; reject: (e: unknown) => void }> = [];

// A 401 from these endpoints is a real credential/auth outcome that the caller must
// handle directly (e.g. wrong password on login) — never route it through the silent
// refresh + redirect flow, which would swallow the error and could cause redirect loops.
const NO_REFRESH_PATHS = ['/auth/login', '/auth/login/2fa', '/auth/register', '/auth/refresh', '/auth/forgot-password', '/auth/reset-password'];

// Public routes where an auth failure must NOT force a hard redirect to /login — doing
// so from a page that itself bootstraps auth creates an infinite reload loop.
const PUBLIC_PATHS = ['/', '/login', '/register', '/forgot-password', '/reset-password', '/google/success'];
const onPublicPath = () =>
  typeof window !== 'undefined' && PUBLIC_PATHS.some((p) => p === '/' ? window.location.pathname === '/' : window.location.pathname.startsWith(p));

http.interceptors.response.use(
  (res) => res,
  async (err: AxiosError<ApiError>) => {
    const original = err.config as AxiosRequestConfig & { _retry?: boolean };
    const url = original?.url || '';

    // Let credential-endpoint 401s bubble straight to the caller.
    if (err.response?.status === 401 && NO_REFRESH_PATHS.some((p) => url.includes(p))) {
      return Promise.reject(err);
    }

    if (err.response?.status === 401 && !original._retry) {
      // No refresh token at all (anonymous visitor): don't attempt refresh or redirect —
      // just reject so bootstrap resolves to "logged out" without looping.
      if (!getRefreshToken()) {
        setAccessToken(null);
        return Promise.reject(err);
      }

      original._retry = true;

      if (refreshing) {
        return new Promise((resolve, reject) => {
          queue.push({ resolve, reject });
        }).then((token) => {
          original.headers = { ...original.headers, Authorization: `Bearer ${token}` };
          return http(original);
        });
      }

      refreshing = true;
      try {
        const rt = getRefreshToken();
        const { data } = await axios.post<AuthResponse>(
          `${BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true, headers: rt ? { 'x-refresh-token': rt } : undefined }
        );
        setAccessToken(data.access_token);
        if (data.refresh_token) setRefreshToken(data.refresh_token);
        queue.forEach((q) => q.resolve(accessToken!));
        queue = [];
        original.headers = { ...original.headers, Authorization: `Bearer ${accessToken}` };
        return http(original);
      } catch (refreshErr) {
        queue.forEach((q) => q.reject(refreshErr));
        queue = [];
        setAccessToken(null);
        setRefreshToken(null);
        // Only bounce to /login from protected pages. On public pages the redirect would
        // reload a page that re-bootstraps auth → 401 → redirect again (infinite loop).
        if (typeof window !== 'undefined' && !onPublicPath()) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshErr);
      } finally {
        refreshing = false;
      }
    }

    return Promise.reject(err);
  }
);

// ─── Helper ───────────────────────────────────────────────────────────────────

const extract = <T>(res: { data: T }) => res.data;

// ─── Auth API ────────────────────────────────────────────────────────────────

export const authApi = {
  // May return a full session OR a { mfa_required, mfa_token } challenge.
  login: (email: string, password: string) =>
    http.post<import('@/types').LoginResult>('/auth/login', { email, password }).then(extract),

  // Second step for 2FA accounts.
  loginMfa: (mfa_token: string, code: string) =>
    http.post<AuthResponse>('/auth/login/2fa', { mfa_token, code }).then(extract),

  // 2FA management (authenticated).
  setup2fa: () => http.post<{ qr: string; secret: string; otpauth: string }>('/auth/2fa/setup').then(extract),
  enable2fa: (code: string) => http.post<{ enabled: true }>('/auth/2fa/enable', { code }).then(extract),
  disable2fa: (code: string) => http.post<{ enabled: false }>('/auth/2fa/disable', { code }).then(extract),

  register: (email: string, password: string, name?: string) =>
    http.post<AuthResponse>('/auth/register', { email, password, name }).then(extract),

  logout: () => http.post('/auth/logout').then(extract),

  me: () => http.get<User>('/auth/me').then(extract),

  // Raw axios (not the intercepted instance) so a 401 here doesn't recurse through the
  // refresh interceptor. Sends the stored refresh token via header for cross-domain.
  refresh: () => {
    const rt = getRefreshToken();
    return axios
      .post<AuthResponse>(`${BASE_URL}/auth/refresh`, {}, {
        withCredentials: true,
        headers: rt ? { 'x-refresh-token': rt } : undefined,
      })
      .then(extract);
  },

  forgotPassword: (email: string) =>
    http.post<{ message: string; reset_url?: string }>('/auth/forgot-password', { email }).then(extract),

  resetPassword: (token: string, password: string) =>
    http.post<{ message: string }>('/auth/reset-password', { token, password }).then(extract),

  changePassword: (currentPassword: string, newPassword: string) =>
    http.post<{ message: string }>('/auth/change-password', { currentPassword, newPassword }).then(extract),

  /** Direct email change — admin accounts only (the backend enforces the role). */
  changeEmail: (email: string) =>
    http.post<{ email: string }>('/auth/change-email', { email }).then(extract),
};

// ─── Credentials API ─────────────────────────────────────────────────────────

export const credentialsApi = {
  get: () => http.get<CredentialSet>('/credentials').then(extract),

  upsert: (data: Partial<CredentialSetInput>) =>
    http.put<CredentialSet>('/credentials', data).then(extract),

  verify: () => http.post<VerifyResult>('/credentials/verify').then(extract),

  /** Facebook Page token expiry — countdown in Settings + renew banner in the dashboard. */
  tokenStatus: () =>
    http.get<{ has_token: boolean; expires_at: string | null; days_left: number | null }>('/credentials/token-status').then(extract),

  /** LIVE Gemini models the saved key can generate with — populates the model dropdown
   *  so it can't go stale when Google retires a model family. */
  geminiModels: () =>
    http.get<{ models: { name: string; displayName: string }[] }>('/credentials/gemini-models').then(extract),
};

// ─── AI token-usage metering ─────────────────────────────────────────────────

export const usageApi = {
  /** Per-day AI token consumption + monthly budget gauge for the dashboard. */
  ai: (days?: number) => http.get<AiUsageSummary>('/ai/usage', { params: days ? { days } : undefined }).then(extract),
};

// ─── Admin API ───────────────────────────────────────────────────────────────

export const adminApi = {
  users: () => http.get<AdminUser[]>('/admin/users').then(extract),
  stats: () => http.get<AdminStats>('/admin/stats').then(extract),
  setSubscription: (userId: string, plan: string, billing?: BillingCycle) =>
    http.patch<SubscriptionStatus>(`/admin/users/${userId}/subscription`, { plan, billing }).then(extract),
  createUser: (data: { email: string; password: string; role?: 'user' | 'admin'; plan?: string }) =>
    http.post<AdminUser>('/admin/users', data).then(extract),
  setRole: (userId: string, role: 'user' | 'admin') =>
    http.patch<{ ok: boolean }>(`/admin/users/${userId}/role`, { role }).then(extract),
  setBlocked: (userId: string, blocked: boolean) =>
    http.patch<{ ok: boolean; blocked: boolean }>(`/admin/users/${userId}/block`, { blocked }).then(extract),
  /** Permanently delete a user + all their data (blocked/never-published accounts only). */
  deleteUser: (userId: string) =>
    http.delete<{ deleted: boolean }>(`/admin/users/${userId}`).then(extract),
  broadcast: (data: {
    subject: string; message: string; target?: 'all' | 'users' | 'admins';
    channels?: ('email' | 'telegram' | 'whatsapp')[]; whatsapp_numbers?: string;
    whatsapp_mode?: 'text' | 'template';
    whatsapp_template_name?: string; whatsapp_template_lang?: string; whatsapp_template_params?: string;
  }) => http.post<BroadcastResult>('/admin/broadcast', data, { timeout: 120000 }).then(extract),

  /** SMTP diagnostics — verifies connection+credentials and returns the REAL provider error. */
  smtpTest: () =>
    http.post<{
      ok: boolean; error?: string; hint?: string;
      host?: string; port?: number; secure?: boolean; transport?: string;
    }>('/admin/smtp-test', {}, { timeout: 30000 }).then(extract),
  /** Fire a Watchdog Telegram test alert; returns whether it reached Telegram. */
  watchdogTest: () =>
    http.post<{ ok: boolean; error?: string }>('/admin/watchdog-test', {}, { timeout: 20000 }).then(extract),
  /** Security audit log (brute-force, privilege escalation, logins, resets). */
  securityEvents: (type?: string) =>
    http.get<SecurityEvent[]>('/admin/security/events', { params: { limit: 100, ...(type ? { type } : {}) } }).then(extract),
  /** Grant one-time credits (manual credit-pack fulfilment until billing lands). */
  addCredits: (userId: string, amount: number) =>
    http.post<{ ok: boolean; credits_remaining: number | null }>(`/admin/users/${userId}/credits`, { amount }).then(extract),
  /** Promotions CRUD (admin-managed sales on plans/packs). */
  promotions: () => http.get<Promotion[]>('/admin/promotions').then(extract),
  createPromotion: (data: Partial<Promotion>) =>
    http.post<Promotion>('/admin/promotions', data).then(extract),
  updatePromotion: (id: string, data: Partial<Promotion>) =>
    http.patch<Promotion>(`/admin/promotions/${id}`, data).then(extract),
  deletePromotion: (id: string) =>
    http.delete<{ deleted: boolean }>(`/admin/promotions/${id}`).then(extract),
};

// ─── Notifications API ───────────────────────────────────────────────────────

export const notificationsApi = {
  get: () => http.get<NotificationPrefs>('/notifications').then(extract),
  update: (data: {
    daily_summary?: boolean; campaign_errors?: boolean;
    daily_summary_hour?: number; insights_hour?: number;
  }) => http.patch<NotificationPrefs>('/notifications', data).then(extract),
  /** Send today's digest to yourself now — proves delivery instead of waiting a day. */
  testDaily: () =>
    http.post<{ sent: boolean; smtp_ready: boolean }>('/notifications/test-daily', {}, { timeout: 60_000 }).then(extract),
};

// ─── Coupons API ─────────────────────────────────────────────────────────────

// ─── Incentive programs (AliExpress portal bonus pools) ──────────────────────

export interface IncentiveProgram {
  id: string;
  name: string;
  keywords_json: string;
  target_campaigns: string | null;
  starts_at: string;
  ends_at: string;
  active: boolean;
  /** The pool's incentive commission rate from the portal, in percent. Null = not entered. */
  bonus_rate_pct: number | null;
  created_at: string;
}

export interface IncentiveInput {
  name?: string;
  keywords?: string[];
  target_campaigns?: string[];
  starts_at?: string;
  ends_at?: string;
  active?: boolean;
  bonus_rate_pct?: number | null;
}

/** What one pool produced inside its window — see incentive.service.stats(). */
export interface IncentivePoolStats {
  posts: number;
  clicks: number;
  orders: number;
  /** BASE commission only — the bonus is paid separately and never reaches our data. */
  revenue_ils: number;
  /** Order value the pool's keywords drove — what the portal applies the bonus rate to. */
  order_amount_usd: number;
  /** order_amount_usd × the pool's rate. Null when no rate was entered. */
  bonus_estimate_usd: number | null;
  /** The bonus AliExpress actually paid on the pool's orders — 0 until the sync has
   *  captured it. Where this is non-zero it replaces the estimate. */
  bonus_paid_usd: number;
}

/**
 * One pool's keywords checked against its own name — see backend pool-audit.ts.
 *
 * The point is the pools already in the database: a matcher bug wrote keywords from the
 * wrong category into them, and fixing the button did nothing for those rows. The autopilot
 * keeps searching them and the bonus keeps not being paid, silently, until this says so.
 */
export interface PoolAudit {
  /** The category the pool NAME reads as, in Hebrew. null = the name is not recognised. */
  nameCategory: string | null;
  /** What the suggestion button would offer for this name now. */
  suggested: string[];
  /** Saved keywords that verifiably belong somewhere else, and to which category. */
  offCategory: Array<{ keyword: string; category: string }>;
  /** Categories the saved keywords read as — what the pool is actually chasing. */
  keywordCategories: string[];
  verdict: 'ok' | 'mismatch' | 'unrecognized';
}

export const incentiveApi = {
  list: () => http.get<IncentiveProgram[]>('/incentive-programs').then(extract),
  /** Per-pool performance, keyed by program id. */
  stats: () => http.get<Record<string, IncentivePoolStats>>('/incentive-programs/stats').then(extract),
  /** Each pool's keywords checked against its own name, keyed by program id. Pure
   *  computation server-side — safe to fetch on every load. */
  audit: () => http.get<Record<string, PoolAudit>>('/incentive-programs/audit').then(extract),
  /** Keywords for a pool name — the recurring pools answer instantly, else one AI call. */
  suggestKeywords: (name: string) =>
    // `matched` names the category the pool NAME was read as — shown on the screen so a
    // mis-recognition is visible before the autopilot spends a month searching it.
    http.post<{ keywords: string[]; source: 'known' | 'ai'; matched?: string }>(
      '/incentive-programs/suggest-keywords', { name }, { timeout: AI_TIMEOUT },
    ).then(extract),
  create: (data: IncentiveInput) =>
    http.post<IncentiveProgram>('/incentive-programs', data).then(extract),
  update: (id: string, data: IncentiveInput) =>
    http.patch<IncentiveProgram>(`/incentive-programs/${id}`, data).then(extract),
  remove: (id: string) =>
    http.delete<{ deleted: boolean }>(`/incentive-programs/${id}`).then(extract),
};

/** What saving a coupon batch built around it — the launch-sequence posts. */
export interface CouponSequenceResult {
  created: number;
  groups: number;
  stages: string[];
  reason?: string;
}

export const couponsApi = {
  list: () => http.get<Coupon[]>('/coupons').then(extract),
  /** Parse a pasted block without saving — for the import preview. */
  preview: (text: string) =>
    http.post<{ coupons: ParsedCoupon[] }>('/coupons/preview', { text }).then(extract),
  /** AI fallback for wording the parser can't read. Costs one AI generation. */
  previewAi: (text: string) =>
    http.post<{ coupons: ParsedCoupon[] }>('/coupons/preview-ai', { text }, { timeout: AI_TIMEOUT }).then(extract),
  // 45s, not the 15s default: the save also builds the launch sequence server-side
  // (anchor lookup + a time-boxed AI hook), and a client that gives up early paints a red
  // "failed" over an import that actually succeeded.
  import: (data: { text: string; campaign?: string; starts_at?: string; ends_at?: string; deals_url?: string }) =>
    http.post<{ imported: number; coupons: Coupon[]; sequence?: CouponSequenceResult }>('/coupons/import', data, { timeout: 45_000 }).then(extract),
  /** Manual add — the fallback when AliExpress wording defeats the parser. */
  add: (data: {
    code: string; discount_usd: number; min_spend_usd: number;
    campaign?: string; starts_at?: string; ends_at?: string; deals_url?: string;
  }) => http.post<Coupon & { sequence?: CouponSequenceResult }>('/coupons', data, { timeout: 45_000 }).then(extract),
  /** Which coupon a product at this USD price would get. */
  best: (priceUsd: number) =>
    http.get<{ coupon: Coupon | null }>('/coupons/best', { params: { price_usd: priceUsd } }).then(extract),
  setActive: (id: string, isActive: boolean) =>
    http.patch<Coupon>(`/coupons/${id}`, { is_active: isActive }).then(extract),
  /** Edit a SAVED coupon's label / validity — the import form could only set them once. */
  update: (id: string, data: { campaign?: string | null; starts_at?: string | null; ends_at?: string | null }) =>
    http.patch<Coupon>(`/coupons/${id}`, data).then(extract),
  remove: (id: string) => http.delete(`/coupons/${id}`).then(extract),
};

// ─── Subscription API ────────────────────────────────────────────────────────

export const subscriptionApi = {
  /** Current plan, credit balance and limits. */
  status: () => http.get<SubscriptionStatus>('/subscription').then(extract),
  /** Plan catalog — prices/credits/limits come from the backend, never hardcode. */
  plans: () => http.get<PlanDef[]>('/subscription/plans').then(extract),
  /** One-time credit-pack catalog. */
  packs: () => http.get<CreditPack[]>('/subscription/packs').then(extract),
  /** Currently-active promotions (public). */
  activeDeals: () => http.get<ActiveDeal[]>('/promotions/active').then(extract),
  /** Self-service upgrade: checkout redirect when a gateway is configured, else a
   *  recorded request for manual activation. */
  upgrade: (plan: string, billing?: BillingCycle) =>
    http.post<{ status: 'checkout' | 'pending'; checkout_url?: string; plan: string; billing: string; price: number }>(
      '/subscription/upgrade', { plan, billing },
    ).then(extract),
  // No self-service switchPlan: plans are paid and there's no payment gateway yet, so
  // upgrades are handled by an admin (PATCH /admin/users/:id/subscription) until billing lands.
};

// ─── Payments API ────────────────────────────────────────────────────────────
export const paymentsApi = {
  /** Which gateway is live ('none' = manual activation). */
  provider: () => http.get<{ provider: string }>('/payments/provider').then(extract),
  /** Create a checkout session (server-computed amount). status 'checkout' → redirect to url. */
  checkout: (input: { kind?: 'subscription' | 'credit_pack'; planId?: string; billing?: BillingCycle; packId?: string }) =>
    http.post<{ status: 'checkout' | 'pending'; url?: string; session_id: string; amount: number }>(
      '/payments/checkout', input,
    ).then(extract),
};

// ─── Scheduled custom posts API ──────────────────────────────────────────────

export const customPostsApi = {
  list: () => http.get<CustomPost[]>('/custom-posts').then(extract),
  create: (data: CustomPostInput) => http.post<CustomPost>('/custom-posts', data).then(extract),
  update: (id: string, data: Partial<CustomPostInput>) =>
    http.patch<CustomPost>(`/custom-posts/${id}`, data).then(extract),
  remove: (id: string) => http.delete(`/custom-posts/${id}`).then(extract),
};

// ─── Integrations API ────────────────────────────────────────────────────────

export interface ClickleadRoiCampaign {
  id: string;
  name: string;
  chat_id: string;
  spend: number;
  leads: number;
  orders: number;
  revenue_ils: number;
  roas: number | null;
  /** The campaign's Telegram group hasn't been proven to belong to this account,
   *  so its revenue is withheld until the one-time verification in ClickLead. */
  unverified?: boolean;
}
export interface ClickleadRoi {
  configured: boolean;
  campaigns: ClickleadRoiCampaign[];
}

export const integrationsApi = {
  /** Scale-only: a ClickLead SSO custom token + URL. `token` is null when SSO isn't
   *  configured yet (no Firebase service account) — caller then opens ClickLead plainly. */
  clickleadSso: () =>
    http.get<{ token: string | null; url: string }>('/integrations/clicklead/sso').then(extract),
  /** Scale-only: ClickLead campaigns (spend+leads) joined with the commissions
   *  their groups earned here — the dashboard ROI widget. */
  clickleadRoi: () =>
    http.get<ClickleadRoi>('/integrations/clicklead/roi', { timeout: 30_000 }).then(extract),
};

// ─── Discovery API ───────────────────────────────────────────────────────────

export const discoveryApi = {
  hunt: (keywords: string[]) =>
    http.post<HuntResult>('/discovery/hunt', { keywords }, { timeout: 240_000 }).then(extract),
  validate: () =>
    http.post<ValidateResult>('/discovery/validate', {}, { timeout: 120_000 }).then(extract),
};

// ─── Campaigns API ───────────────────────────────────────────────────────────

/** One risky keyword found in a campaign, as the backend audit reports it. */
export interface KeywordFinding {
  campaign_id: string;
  campaign_name: string;
  status: string;
  /** The keyword is out of rotation (retired by the optimizer) — lower urgency. */
  retired: boolean;
  keyword: string;
  risk: 'high' | 'watch';
  reason: string;
  suggestion?: string;
}

export interface KeywordAudit {
  campaigns: number;
  keywords_scanned: number;
  high: number;
  watch: number;
  findings: KeywordFinding[];
}

export const campaignsApi = {
  /** Active + upcoming commercial-calendar events for the dashboard strip. */
  seasonal: () =>
    http.get<{ active: Array<{ key: string; name: string; emoji: string; audience: string }>;
               upcoming: Array<{ key: string; name: string; emoji: string; audience: string; opens_in_days: number }> }>('/campaigns/seasonal').then(extract),

  list: (params?: { page?: number; limit?: number; status?: string }) =>
    http.get<PaginatedResponse<Campaign>>('/campaigns', { params }).then(extract),

  /** Translate all campaigns' Hebrew keywords to English in place. */
  translateKeywords: () =>
    http.post<{ campaigns_updated: number; translations: Array<{ campaign: string; before: string; after: string }> }>(
      '/campaigns/translate-keywords', {}, { timeout: 120_000 },
    ).then(extract),

  /** Brand / counterfeit-magnet keywords across every campaign — a report, not a guard. */
  keywordAudit: () =>
    http.get<KeywordAudit>('/campaigns/keyword-audit').then(extract),

  get: (id: string) => http.get<Campaign>(`/campaigns/${id}`).then(extract),

  create: (data: CampaignInput) =>
    http.post<Campaign>('/campaigns', data).then(extract),

  update: (id: string, data: Partial<CampaignInput>) =>
    http.patch<Campaign>(`/campaigns/${id}`, data).then(extract),

  delete: (id: string) => http.delete(`/campaigns/${id}`).then(extract),

  pause: (id: string) => http.post<Campaign>(`/campaigns/${id}/pause`).then(extract),

  resume: (id: string) => http.post<Campaign>(`/campaigns/${id}/resume`).then(extract),

  /** Runs the campaign and waits for the real outcome — a search + an AI generation per
   *  post, so it needs far more than the 15s global timeout. */
  runNow: (id: string) =>
    http.post<CampaignRunResult>(`/campaigns/${id}/run`, {}, { timeout: 180_000 }).then(extract),

  posts: (id: string, params?: { page?: number; limit?: number }) =>
    http.get<PaginatedResponse<Post>>(`/campaigns/${id}/posts`, { params }).then(extract),
};

// ─── Products API ─────────────────────────────────────────────────────────────

export const productsApi = {
  search: (params: {
    keyword: string;
    category_id?: string;
    min_price?: number;
    max_price?: number;
    min_discount?: number;
    sort?: string;
    page?: number;
    limit?: number;
  }) => http.get<PaginatedResponse<AliProduct>>('/products/search', { params }).then(extract),

  featured: (params?: {
    category_id?: string;
    sort?: 'best_selling' | 'most_discounted';
    page?: number;
    limit?: number;
  }) => http.get<PaginatedResponse<AliProduct>>('/products/featured', { params }).then(extract),

  promotional: (params?: {
    category_id?: string;
    page?: number;
    limit?: number;
  }) => http.get<PaginatedResponse<AliProduct>>('/products/promotional', { params }).then(extract),

  refreshPrice: (productId: string) =>
    http.get<AliProduct | null>(`/products/${productId}/refresh-price`).then(extract),

  categories: () => http.get<AliCategory[]>('/products/categories').then(extract),

  affiliateLink: (product_id: string) =>
    http.post<{ url: string }>('/products/affiliate-link', { product_id }).then(extract),
};

// ─── Posts API ───────────────────────────────────────────────────────────────

// AI text generation (Gemini/Claude) plus a Render cold start can take well over the
// 15s global timeout, so the generate/publish/schedule calls get a longer one.
const AI_TIMEOUT = 60_000;

/** Product price/title the UI already has — sent with quick/scheduled posts so the
 *  post keeps the real price instead of a ₪0, empty-title post. */
type QuickPostProduct = {
  title?: string; sale_price?: number; original_price?: number; currency?: string;
  discount_percent?: number; orders_count?: number; rating?: number;
};

/** Limited-time promo params sent to the AI copy generator (preview). */
export interface PromoPreview { discount?: number | null; ends_at?: string | null }
/** Limited-time promo params persisted with a quick/scheduled post. */
export interface PromoInput { is_promo: boolean; ends_at?: string | null; discount?: number | null }

/**
 * Platforms a already-created post can be back-filled to. The full set the server's push
 * endpoint handles — it has accepted pinterest and whatsapp all along, while the dialog
 * offered only the first three and quietly made them unreachable.
 */
export type PushPlatform = 'telegram' | 'facebook' | 'instagram' | 'pinterest' | 'whatsapp';

export const postsApi = {
  preview: (product_id: string, language?: string, custom_product?: Partial<AliProduct>, template?: string, promo?: PromoPreview, hint?: string) =>
    http.post<PostPreview>('/posts/preview', { product_id, language, custom_product, template, promo, hint }, { timeout: AI_TIMEOUT }).then(extract),

  /** Regenerate a post's copy from the editor's current fields — the server feeds the
   *  post's actual photo(s) to the AI (vision) with the edited title as ground truth. */
  regeneratePost: (id: string, data: { title?: string; price_ils?: number; image_url?: string }) =>
    http.post<PostPreview>(`/posts/${id}/regenerate`, data, { timeout: AI_TIMEOUT }).then(extract),

  quickPost: (data: { product_id: string; text?: string; channel_override?: string; channels?: string[]; product_image?: string; affiliate_url?: string; product?: QuickPostProduct; promo?: PromoInput }) =>
    http.post<Post>('/posts/quick', data, { timeout: AI_TIMEOUT }).then(extract),

  /** Bulk file import: rows parsed client-side, resolved+queued server-side per batch. */
  importRows: (rows: Array<{ keyword?: string; title: string; benefits: string[]; link: string }>, channels?: string[]) =>
    http.post<{ queued: number; duplicates: number; enriched: number; failed: number; results: Array<{ title: string; status: string; reason?: string }> }>(
      '/posts/import', { rows, channels }, { timeout: 120_000 },
    ).then(extract),

  /** One-image Nano Banana preview (before/after) — costs one Gemini call on the user's key. */
  enhancePreview: (imageUrl?: string) =>
    http.post<{ before: string; after_data_url: string }>(
      '/posts/enhance-preview', { image_url: imageUrl }, { timeout: 90_000 },
    ).then(extract),

  list: (params?: {
    page?: number; limit?: number; status?: string; campaign_id?: string;
    source?: 'aliexpress' | 'flylink';
    platform?: 'telegram' | 'facebook' | 'instagram' | 'pinterest' | 'whatsapp';
  }) =>
    http.get<PaginatedResponse<Post>>('/posts', { params }).then(extract),

  retry: (id: string) => http.post<Post>(`/posts/${id}/retry`, {}, { timeout: AI_TIMEOUT }).then(extract),

  /** Re-send ONLY the platform(s) that failed on a partially-published post. */
  retryFailed: (id: string) => http.post<Post>(`/posts/${id}/retry-failed`, {}, { timeout: AI_TIMEOUT }).then(extract),

  /** Re-publish a post via the queue (no time) or schedule it (with scheduled_at). */
  /** Device image upload → public URL. The explicit multipart content type is REQUIRED:
   *  this instance defaults to application/json, and axios v1's transformRequest turns a
   *  FormData under a JSON content type into JSON.stringify(formDataToJSON(fd)) — the File
   *  serializes to {} and the server sees no file at all ("לא התקבל קובץ תמונה"). With
   *  multipart declared, the FormData passes through and the browser sets the boundary. */
  uploadImage: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return http.post<{ url: string }>('/posts/upload-image', fd, {
      timeout: 60_000,
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(extract);
  },

  /** Smart link intake — resolve, judge, file the keyword, schedule. AI-scale latency.
   *  When the judge can't place the product, the response carries needs_choice + the
   *  campaign list; re-call with campaign_id / campaign_ids (the owner's picks — more
   *  than one creates a post through EACH chosen campaign) or to_queue. */
  smartIntake: (url: string, opts?: { campaign_id?: string; campaign_ids?: string[]; to_queue?: boolean }) =>
    http.post<{
      needs_choice?: boolean; product_title?: string;
      campaigns?: Array<{ id: string; name: string; status: string }>;
      post_id?: string; keyword: string; campaign_name?: string | null;
      keyword_added?: boolean; scheduled_at?: string | null; note?: string;
      posts?: Array<{ post_id: string; campaign_name: string | null; scheduled_at: string | null }>;
    }>('/posts/smart-intake', { url, ...opts }, { timeout: AI_TIMEOUT }).then(extract),

  requeue: (id: string, scheduledAt?: string, channels?: string[], platforms?: PushPlatform[]) =>
    http.post<Post>(`/posts/${id}/requeue`, {
      scheduled_at: scheduledAt, channels, platforms,
    }).then(extract),

  /** Push an existing post to chosen platform(s) + group(s) — no re-charge, no duplicates.
   *  pinterestRewrite regenerates the pin's copy in English + USD (costs one AI
   *  generation); the stored post keeps the text it already published. */
  push: (id: string, platforms: PushPlatform[], channels?: string[], pinterestRewrite?: boolean) =>
    http.post<Post>(`/posts/${id}/push`, { platforms, channels, pinterest_rewrite: pinterestRewrite }, { timeout: AI_TIMEOUT }).then(extract),

  /** Pin this post as the template FLYLINK re-posts clone for its product (copy + images). */
  setRepostSource: (id: string) =>
    http.post<Post>(`/posts/${id}/repost-source`).then(extract),

  /** Full post edit: text, title, price, image, affiliate link, target group(s) and/or
   *  scheduled time. */
  update: (id: string, data: {
    text?: string; scheduled_at?: string;
    product_title?: string; price_ils?: number; product_image?: string; affiliate_url?: string;
    /** Ordered gallery re-selection — first image becomes the main one. */
    gallery?: string[];
    /** Re-target the post to other group(s); [] = back to the default channel. */
    channels?: string[];
  }) => http.patch<Post>(`/posts/${id}`, data).then(extract),

  /** Delete any post (queued/scheduled/sent/failed). */
  remove: (id: string) => http.delete(`/posts/${id}`).then(extract),

  schedulePost: (data: { product_id: string; scheduled_at: string; text?: string; channel_override?: string; channels?: string[]; product_image?: string; affiliate_url?: string; product?: QuickPostProduct; promo?: PromoInput; images?: string[] }) =>
    http.post<Post>('/posts/schedule', data, { timeout: AI_TIMEOUT }).then(extract),

  // ── Queue ──
  listQueue: () => http.get<Post[]>('/posts/queue').then(extract),
  dequeue: (id: string) => http.delete(`/posts/queue/${id}`).then(extract),

  /** One-click add-to-queue — the scheduler picks the send time from the user's settings. */
  addToQueue: (product: Partial<AliProduct> & { image_url?: string; affiliate_url?: string }, text?: string, channels?: string[]) =>
    http.post<{ post: Post; queue_active: boolean; interval_minutes: number; window_start: number; window_end: number }>(
      '/posts/queue', { product, text, channels }, { timeout: AI_TIMEOUT },
    ).then(extract),
};

// ─── Revenue attribution API ─────────────────────────────────────────────────

export interface AttributionSummary {
  by_keyword: Array<{ keyword: string; orders: number; revenue_ils: number; clicks: number; posts: number }>;
  by_campaign: Array<{ campaign_id: string; name: string; orders: number; revenue_ils: number }>;
  unattributed: { orders: number; revenue_ils: number };
}

// ─── Pinterest analytics API ─────────────────────────────────────────────────

export interface PinAnalyticsRow {
  post_id: string; pin_id: string; title: string; image: string; sent_at: string | null;
  impressions: number; saves: number; pin_clicks: number; outbound_clicks: number;
}

export interface PinterestAnalytics {
  available: boolean;
  reason?: string;
  totals: { impressions: number; saves: number; pin_clicks: number; outbound_clicks: number; pins: number } | null;
  pins: PinAnalyticsRow[];
}

export const pinterestApi = {
  /** Per-pin performance (30 days) + totals for the reports screen.
   *  refresh bypasses the server's hourly cache — it re-reads every pin from Pinterest
   *  (dozens of sequential API calls), hence the long timeout. */
  analytics: (refresh = false) =>
    http.get<PinterestAnalytics>('/pinterest/analytics', {
      params: refresh ? { refresh: 1 } : undefined,
      timeout: 60_000,
    }).then(extract),
  /** The account's boards — the numeric board id is invisible in Pinterest's own UI. */
  boards: () => http.get<{ boards: Array<{ id: string; name: string }>; reason?: string }>(
    '/pinterest/boards', { timeout: 20_000 },
  ).then(extract),
  /** Where to send the owner to approve the connection (OAuth step 1). */
  connect: () => http.get<{ url: string }>('/pinterest/connect').then(extract),
};

// ─── Earnings API ────────────────────────────────────────────────────────────

export const statsApi = {
  /** Dashboard headline — commissions, clicks and posts by calendar month: current month,
   *  full previous month, elapsed-stretch delta and a monthly trend series. */
  overview: (months = 12) =>
    http.get<OverviewStats>('/stats/overview', { params: { months } }).then(extract),
  /** Clicks per platform (tg/fb/ig/wa; 'other' = untagged history) over the last N days. */
  clickSources: (days = 30) =>
    http.get<{ days: number; total: number; sources: Array<{ source: string; clicks: number }> }>(
      '/stats/click-sources', { params: { days } },
    ).then(extract),
};

export const earningsApi = {
  summary: (params?: { period?: '7d' | '30d' | '90d' | 'month' | 'all' }) =>
    http.get<EarningsSummary>('/earnings/summary', { params }).then(extract),

  /** "What actually earns" — commissions by keyword/campaign + clicks. */
  attribution: () => http.get<AttributionSummary>('/earnings/attribution').then(extract),

  list: (params?: { page?: number; limit?: number; status?: string; from?: string; to?: string; date_basis?: 'order' | 'paid' }) =>
    http.get<PaginatedResponse<Earning> & {
      totals: { amount_usd: number; commission_usd: number; commission_ils: number; count: number };
    }>('/earnings', { params }).then(extract),

  // Sync loops 4 order statuses with pacing against the AliExpress rate limit —
  // can take ~10-40s, well past the 15s global timeout.
  /** Starts a BACKGROUND sync (returns immediately) — poll syncStatus for the outcome. */
  sync: () => http.post<{ state: 'started' | 'running' }>('/earnings/sync', {}).then(extract),
  syncStatus: () => http.get<{
    state: 'idle' | 'running' | 'done' | 'error';
    result?: { synced: number; updated: number; by_status?: Record<string, { found: number; new: number; updated: number; error?: string }> };
    error?: string;
  }>('/earnings/sync/status').then(extract),

  /** The account's own orders as CSV — downloaded through axios so the JWT rides along
   *  (a plain <a href> download carries no Authorization header). */
  exportCsv: () =>
    http.get('/earnings/export.csv', { responseType: 'blob' }).then((r) => r.data as Blob),

  /** Compare the portal's own export against the DB — which sub-order never arrived. */
  reconcile: (csv: string) =>
    http.post<{
      portal_rows: number;
      matched: number;
      missing: Array<{
        sub_order_id: string; order_id: string; product_id: string; title: string;
        commission_usd: number; amount_usd: number; paid_at: string; status: string;
      }>;
      extra: Array<{ order_id: string; product_id: string; commission_usd: number }>;
      extra_count: number;
      note: string | null;
    }>('/earnings/reconcile', { csv }, { timeout: 60_000 }).then(extract),
};

// ─── Channels API ────────────────────────────────────────────────────────────

export const channelsApi = {
  list: () => http.get<Channel[]>('/channels').then(extract),

  create: (data: CreateChannelInput) =>
    http.post<Channel>('/channels', data).then(extract),

  update: (id: string, data: UpdateChannelInput) =>
    http.patch<Channel>(`/channels/${id}`, data).then(extract),

  delete: (id: string) => http.delete(`/channels/${id}`).then(extract),

  test: (id: string) =>
    http.post<{ ok: boolean; error?: string }>(`/channels/${id}/test`).then(extract),

  /** Verify the channel's Facebook page (valid token + publish permission). */
  testFacebook: (id: string) =>
    http.post<{ ok: boolean; error?: string; page_name?: string; note?: string }>(`/channels/${id}/test-facebook`).then(extract),

  /** Verify the account's Instagram Business account + linked Page token (account-global). */
  testInstagram: () =>
    http.post<{ ok: boolean; error?: string; username?: string; name?: string | null; suggested_id?: string; suggested_username?: string | null; suggested_page_id?: string }>(`/channels/test-instagram`).then(extract),

  /** Verify the account's Pinterest access token + target board (account-global). */
  testPinterest: () =>
    http.post<{ ok: boolean; error?: string; board_name?: string }>(`/channels/test-pinterest`).then(extract),

  /** Verify the account's WhatsApp setup (Green API authorized / Cloud API token). */
  testWhatsApp: () =>
    http.post<{ ok: boolean; error?: string; state?: string }>(`/channels/test-whatsapp`).then(extract),

  /** Ask the owner's own Green API instance whether it can see WhatsApp channels. */
  whatsappChannelSupport: () =>
    http.post<{
      ok: boolean;
      verdict: 'supported' | 'unsupported' | 'unknown';
      total_chats: number;
      channels: Array<{ id: string; name: string }>;
      message: string;
    }>(`/channels/whatsapp-channel-support`, {}, { timeout: 30_000 }).then(extract),

  /** Try to actually publish to a channel — text and image reported separately. */
  testWhatsAppChannelSend: (chatId: string) =>
    http.post<{
      ok: boolean;
      error: string | null;
      text: { ok: boolean; detail: string } | null;
      image: { ok: boolean; detail: string } | null;
    }>(`/channels/test-whatsapp-channel`, { chat_id: chatId }, { timeout: 60_000 }).then(extract),
};

// ─── Amazon (PA-API) ─────────────────────────────────────────────────────────

export const amazonApi = {
  /** Verify the account's Amazon PA-API credentials with a minimal live SearchItems call. */
  test: () =>
    http.post<{ ok: boolean; error?: string; sample?: string; count?: number }>(`/amazon/test`).then(extract),
};

// ─── Templates API ──────────────────────────────────────────────────────────

export const templatesApi = {
  list: () => http.get<PostTemplate[]>('/templates').then(extract),

  create: (data: { name: string; content: string; icon?: string; type?: string }) =>
    http.post<PostTemplate>('/templates', data).then(extract),

  update: (id: string, data: { name?: string; content?: string; icon?: string; type?: string }) =>
    http.patch<PostTemplate>(`/templates/${id}`, data).then(extract),

  remove: (id: string) => http.delete(`/templates/${id}`).then(extract),
};

// ─── Exchange Rate API ───────────────────────────────────────────────────────

export const ratesApi = {
  get: () => http.get<{ USD_ILS: number; USD_EUR: number; updated_at: string }>('/rates').then(extract),
};

// ─── Learning Optimizer API ──────────────────────────────────────────────────

export const optimizerApi = {
  /**
   * Run the nightly pass now and get back the digest it would have sent. Scoring every
   * keyword across every active campaign (plus the email) runs well past the 15s default.
   */
  run: () => http.post<{ ok: boolean; digest?: string; detail?: string; reason?: string }>(
    '/optimizer/run', {}, { timeout: 180_000 },
  ).then(extract),

  /** Every change the engine made lately, newest first — the "what did it do" screen. */
  actions: (days = 14) => http.get<OptimizerAction[]>(
    '/optimizer/actions', { params: { days } },
  ).then(extract),

  /** Put one change back. The engine acts on its own; this is the other half of that. */
  undo: (id: string) => http.post<{ ok: boolean; label?: string; reason?: string }>(
    '/optimizer/actions/undo', { id },
  ).then(extract),

  /** The full report behind the last brief — the evidence, on request. */
  detail: () => http.get<{ detail: string | null }>('/optimizer/detail').then(extract),
};

// ─── Storefront API ──────────────────────────────────────────────────────────

/**
 * The PUBLIC store endpoints. Deliberately on a bare axios call rather than the shared
 * instance: a follower browsing the store has no session, and the instance's 401 →
 * refresh → retry interceptor would turn an ordinary 404 into a login round-trip.
 */
export const storeApi = {
  meta: (slug: string) =>
    axios.get<StoreMeta>(`${BASE_URL}/store/${encodeURIComponent(slug)}`).then((r) => r.data),

  products: (slug: string, params: StoreQuery = {}) =>
    axios.get<StorePage>(`${BASE_URL}/store/${encodeURIComponent(slug)}/products`, { params })
      .then((r) => r.data),

  product: (slug: string, id: string) =>
    axios.get<StoreProduct & { buy_url: string }>(
      `${BASE_URL}/store/${encodeURIComponent(slug)}/products/${encodeURIComponent(id)}`,
    ).then((r) => r.data),
};

/** The owner's side of their store. */
export const storefrontApi = {
  get: () => http.get<StorefrontSettings>('/storefront').then(extract),
  update: (data: Partial<StorefrontSettings>) =>
    http.patch<StorefrontSettings>('/storefront', data).then(extract),
};

// ─── Catalog API ─────────────────────────────────────────────────────────────

export const catalogApi = {
  list: (params?: {
    page?: number; limit?: number; status?: string; has_post?: boolean; search?: string;
  }) => http.get<PaginatedResponse<CatalogProduct>>('/catalog', { params }).then(extract),

  stats: () => http.get<CatalogStats>('/catalog/stats').then(extract),

  importProduct: (data: { url?: string; product_id?: string; category?: string }) =>
    http.post<CatalogProduct>('/catalog/import', data).then(extract),

  /** Bulk-import from a parsed CSV. Returns a per-batch summary. */
  bulkImport: (rows: { product_id: string; category?: string }[]) =>
    http.post<{ total: number; imported: number; skipped: number; failed: number; errors: { productId: string; error: string }[] }>(
      '/catalog/import/bulk', { rows }, { timeout: 240_000 },
    ).then(extract),

  get: (id: string) => http.get<CatalogProduct>(`/catalog/${id}`).then(extract),

  update: (id: string, data: Partial<CatalogProduct>) =>
    http.put<CatalogProduct>(`/catalog/${id}`, data).then(extract),

  remove: (id: string) => http.delete(`/catalog/${id}`).then(extract),

  approve: (id: string) =>
    http.patch<CatalogProduct>(`/catalog/${id}/approve`).then(extract),

  reject: (id: string) =>
    http.patch<CatalogProduct>(`/catalog/${id}/reject`).then(extract),

  sync: (id: string) =>
    http.post<CatalogProduct>(`/catalog/${id}/sync`).then(extract),

  // AI generation (Gemini/Claude) can outlast the 15s global timeout.
  generateDescription: (id: string) =>
    http.post<{ description: string }>(`/catalog/${id}/generate-description`, {}, { timeout: AI_TIMEOUT }).then(extract),

  // Starts a BACKGROUND re-price job on the server (returns immediately);
  // progress is polled via resyncStatus until running=false.
  resyncPrices: () =>
    http.post<ResyncJob>('/catalog/resync-prices').then(extract),

  resyncStatus: () =>
    http.get<ResyncJob>('/catalog/resync-status').then(extract),

  affiliateLink: (id: string) =>
    http.post<{ url: string }>(`/catalog/${id}/affiliate-link`).then(extract),

  queue: (id: string) =>
    http.post<Post>(`/catalog/${id}/queue`).then(extract),

  queueBatch: (ids: string[]) =>
    http.post<{ id: string; success: boolean; error?: string }[]>('/catalog/queue-batch', { ids }).then(extract),
};

// ─── Suppliers API (Yupoo ↔ FLYLINK) ─────────────────────────────────────────

export const suppliersApi = {
  // Catalogs
  listCatalogs: () => http.get<SupplierCatalog[]>('/suppliers/catalogs').then(extract),
  createCatalog: (data: Partial<SupplierCatalog>) =>
    http.post<SupplierCatalog>('/suppliers/catalogs', data).then(extract),
  updateCatalog: (id: string, data: Partial<SupplierCatalog>) =>
    http.patch<SupplierCatalog>(`/suppliers/catalogs/${id}`, data).then(extract),
  deleteCatalog: (id: string) => http.delete(`/suppliers/catalogs/${id}`).then(extract),
  probeStore: (store: string, password?: string) =>
    http.get<{ count: number; sample_code: string | null; suggested_mode: string; samples: any[] }>(
      '/suppliers/catalogs/probe', { params: { store, ...(password ? { password } : {}) }, timeout: 30_000 },
    ).then(extract),

  browse: (catalogId: string, params: { page?: number; category?: string; is_sub?: 0 | 1; with_categories?: 0 | 1 }) =>
    http.get<{
      items: Array<{ code: string; price: number; currency?: string; description: string; album_url: string; thumb?: string }>;
      hasMore: boolean;
      categories?: Array<{ id: string; name: string; isSubCate: boolean }>;
    }>(`/suppliers/catalogs/${catalogId}/browse`, { params, timeout: 30_000 }).then(extract),

  /** Search the catalogs' Yupoo stores by album title — one catalog, or all of them. */
  searchCatalogs: (q: string, params: { catalog_id?: string; page?: number } = {}) =>
    http.get<{
      query: string;
      hebrew: boolean;
      results: Array<{
        catalog_id: string;
        catalog_name: string;
        hasMore: boolean;
        error?: string;
        items: Array<{ code: string; price: number; currency?: string; description: string; album_url: string; thumb?: string; linked_product_id?: string | null }>;
      }>;
    }>('/suppliers/catalogs/search', { params: { q, ...params }, timeout: 60_000 }).then(extract),

  // Products
  listProducts: (catalogId?: string) =>
    http.get<SupplierProduct[]>('/suppliers/products', { params: catalogId ? { catalog_id: catalogId } : undefined }).then(extract),
  link: (data: {
    catalogId: string; yupooUrl: string; flylinkUrl: string; code?: string;
    album?: { code?: string; price?: number; currency?: string; description?: string; title?: string; images?: string[]; album_url?: string };
  }) =>
    http.post<SupplierProduct & { sku_verified: boolean }>('/suppliers/products/link', data, { timeout: 50_000 }).then(extract),
  /**
   * Paste a batch of FLYLINK links and let the server match each to its album. Every link
   * costs a redirect fetch on top of the store scan, so this needs the long timeout.
   */
  bulkLink: (catalogId: string, text: string) =>
    http.post<BulkLinkResult>('/suppliers/products/bulk-link', { catalogId, text }, { timeout: 300_000 }).then(extract),
  /**
   * Run the enrichment agent now. Each product is a vision call, so this outlives the
   * default timeout the way the optimizer's manual run does.
   */
  enrich: () => http.post<{ looked: number; named: number; reason?: string }>(
    '/suppliers/products/enrich', {}, { timeout: 300_000 },
  ).then(extract),
  updateProduct: (id: string, data: Partial<SupplierProduct>) =>
    http.patch<SupplierProduct>(`/suppliers/products/${id}`, data).then(extract),
  deleteProduct: (id: string) => http.delete(`/suppliers/products/${id}`).then(extract),
  /** Image choices for a post's gallery editor: its current gallery + the full catalog album. */
  postGalleryOptions: (postId: string) =>
    http.get<{ current: string[]; catalog: string[] }>(`/suppliers/post-gallery/${postId}`).then(extract),
  generateDescription: (id: string) =>
    http.post<{ description: string }>(`/suppliers/products/${id}/generate-description`, {}, { timeout: AI_TIMEOUT }).then(extract),

  /** Full Yupoo album (all color images) for the post-creation modal — no save. */
  previewAlbum: (catalogId: string, url: string) =>
    http.post<{
      code: string; price: number; currency: string; source_price?: number; source_currency?: string;
      description: string; title: string; images: string[]; raw_images: string[]; album_url: string;
    }>('/suppliers/album/preview', { catalogId, url }, { timeout: 30_000 }).then(extract),

  /** AI-generate / regenerate the post text (quick-post preview) for a saved product — same Gemini + template flow as AliExpress. `vision` lets the AI write from the product photos; `hint` is an authoritative product-type override. */
  preview: (id: string, opts?: { language?: string; template?: string; vision?: boolean; hint?: string }) =>
    http.post<PostPreview & { gallery: string[]; vision_used: boolean }>(`/suppliers/products/${id}/preview`, opts || {}, { timeout: AI_TIMEOUT }).then(extract),

  queue: (id: string, channelId?: string, text?: string, images?: string[], collageCells?: number, channels?: string[]) =>
    http.post<{ queued: boolean; post_id: string; channels: string[]; queue_active: boolean; interval_minutes: number }>(
      `/suppliers/products/${id}/queue`, { channel_id: channelId, channels, text, images, collage_cells: collageCells }, { timeout: AI_TIMEOUT }).then(extract),

  send: (id: string, channelId?: string, text?: string, images?: string[], collageCells?: number, channels?: string[]) =>
    http.post<{ sent: boolean; post_id: string; channels: string[] }>(
      `/suppliers/products/${id}/send`, { channel_id: channelId, channels, text, images, collage_cells: collageCells }, { timeout: AI_TIMEOUT }).then(extract),

  schedule: (id: string, scheduledAt: string, channelId?: string, text?: string, images?: string[], collageCells?: number, channels?: string[]) =>
    http.post<{ scheduled: boolean; post_id: string; channels: string[]; at: string }>(
      `/suppliers/products/${id}/schedule`, { scheduled_at: scheduledAt, channel_id: channelId, channels, text, images, collage_cells: collageCells }, { timeout: AI_TIMEOUT }).then(extract),
};

export default http;
