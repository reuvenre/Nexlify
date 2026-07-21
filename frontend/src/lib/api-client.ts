import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import type {
  User,
  AuthResponse,
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
  BillingCycle,
  SupplierCatalog,
  SupplierProduct,
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
};

// ─── Credentials API ─────────────────────────────────────────────────────────

export const credentialsApi = {
  get: () => http.get<CredentialSet>('/credentials').then(extract),

  upsert: (data: Partial<CredentialSetInput>) =>
    http.put<CredentialSet>('/credentials', data).then(extract),

  verify: () => http.post<VerifyResult>('/credentials/verify').then(extract),
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
  broadcast: (data: {
    subject: string; message: string; target?: 'all' | 'users' | 'admins';
    channels?: ('email' | 'telegram' | 'whatsapp')[]; whatsapp_numbers?: string;
    whatsapp_mode?: 'text' | 'template';
    whatsapp_template_name?: string; whatsapp_template_lang?: string; whatsapp_template_params?: string;
  }) => http.post<BroadcastResult>('/admin/broadcast', data, { timeout: 120000 }).then(extract),
};

// ─── Notifications API ───────────────────────────────────────────────────────

export const notificationsApi = {
  get: () => http.get<NotificationPrefs>('/notifications').then(extract),
  update: (data: { daily_summary?: boolean; campaign_errors?: boolean }) =>
    http.patch<NotificationPrefs>('/notifications', data).then(extract),
  /** Send today's digest to yourself now — proves delivery instead of waiting a day. */
  testDaily: () =>
    http.post<{ sent: boolean; smtp_ready: boolean }>('/notifications/test-daily', {}, { timeout: 60_000 }).then(extract),
};

// ─── Coupons API ─────────────────────────────────────────────────────────────

export const couponsApi = {
  list: () => http.get<Coupon[]>('/coupons').then(extract),
  /** Parse a pasted block without saving — for the import preview. */
  preview: (text: string) =>
    http.post<{ coupons: ParsedCoupon[] }>('/coupons/preview', { text }).then(extract),
  /** AI fallback for wording the parser can't read. Costs one AI generation. */
  previewAi: (text: string) =>
    http.post<{ coupons: ParsedCoupon[] }>('/coupons/preview-ai', { text }, { timeout: AI_TIMEOUT }).then(extract),
  import: (data: { text: string; campaign?: string; starts_at?: string; ends_at?: string }) =>
    http.post<{ imported: number; coupons: Coupon[] }>('/coupons/import', data).then(extract),
  /** Manual add — the fallback when AliExpress wording defeats the parser. */
  add: (data: {
    code: string; discount_usd: number; min_spend_usd: number;
    campaign?: string; starts_at?: string; ends_at?: string;
  }) => http.post<Coupon>('/coupons', data).then(extract),
  /** Which coupon a product at this USD price would get. */
  best: (priceUsd: number) =>
    http.get<{ coupon: Coupon | null }>('/coupons/best', { params: { price_usd: priceUsd } }).then(extract),
  setActive: (id: string, isActive: boolean) =>
    http.patch<Coupon>(`/coupons/${id}`, { is_active: isActive }).then(extract),
  remove: (id: string) => http.delete(`/coupons/${id}`).then(extract),
};

// ─── Subscription API ────────────────────────────────────────────────────────

export const subscriptionApi = {
  /** Current plan, credit balance and limits. */
  status: () => http.get<SubscriptionStatus>('/subscription').then(extract),
  /** Plan catalog — prices/credits/limits come from the backend, never hardcode. */
  plans: () => http.get<PlanDef[]>('/subscription/plans').then(extract),
  // No self-service switchPlan: plans are paid and there's no payment gateway yet, so
  // upgrades are handled by an admin (PATCH /admin/users/:id/subscription) until billing lands.
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

export const integrationsApi = {
  /** Scale-only: a ClickLead SSO custom token + URL. `token` is null when SSO isn't
   *  configured yet (no Firebase service account) — caller then opens ClickLead plainly. */
  clickleadSso: () =>
    http.get<{ token: string | null; url: string }>('/integrations/clicklead/sso').then(extract),
};

// ─── Discovery API ───────────────────────────────────────────────────────────

export const discoveryApi = {
  hunt: (keywords: string[]) =>
    http.post<HuntResult>('/discovery/hunt', { keywords }, { timeout: 240_000 }).then(extract),
  validate: () =>
    http.post<ValidateResult>('/discovery/validate', {}, { timeout: 120_000 }).then(extract),
};

// ─── Campaigns API ───────────────────────────────────────────────────────────

export const campaignsApi = {
  list: (params?: { page?: number; limit?: number; status?: string }) =>
    http.get<PaginatedResponse<Campaign>>('/campaigns', { params }).then(extract),

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

export const postsApi = {
  preview: (product_id: string, language?: string, custom_product?: Partial<AliProduct>, template?: string) =>
    http.post<PostPreview>('/posts/preview', { product_id, language, custom_product, template }, { timeout: AI_TIMEOUT }).then(extract),

  quickPost: (data: { product_id: string; text?: string; channel_override?: string; channels?: string[]; product_image?: string; affiliate_url?: string; product?: QuickPostProduct }) =>
    http.post<Post>('/posts/quick', data, { timeout: AI_TIMEOUT }).then(extract),

  list: (params?: { page?: number; limit?: number; status?: string; campaign_id?: string; source?: 'aliexpress' | 'flylink' }) =>
    http.get<PaginatedResponse<Post>>('/posts', { params }).then(extract),

  retry: (id: string) => http.post<Post>(`/posts/${id}/retry`, {}, { timeout: AI_TIMEOUT }).then(extract),

  /** Re-send ONLY the platform(s) that failed on a partially-published post. */
  retryFailed: (id: string) => http.post<Post>(`/posts/${id}/retry-failed`, {}, { timeout: AI_TIMEOUT }).then(extract),

  /** Re-publish a post via the queue (no time) or schedule it (with scheduled_at). */
  requeue: (id: string, scheduledAt?: string) =>
    http.post<Post>(`/posts/${id}/requeue`, { scheduled_at: scheduledAt }).then(extract),

  /** Push an existing post to chosen platform(s) + group(s) — no re-charge, no duplicates. */
  push: (id: string, platforms: ('telegram' | 'facebook' | 'instagram')[], channels?: string[]) =>
    http.post<Post>(`/posts/${id}/push`, { platforms, channels }, { timeout: AI_TIMEOUT }).then(extract),

  /** Full post edit: text, title, price, image, affiliate link, and/or scheduled time. */
  update: (id: string, data: {
    text?: string; scheduled_at?: string;
    product_title?: string; price_ils?: number; product_image?: string; affiliate_url?: string;
  }) => http.patch<Post>(`/posts/${id}`, data).then(extract),

  /** Delete any post (queued/scheduled/sent/failed). */
  remove: (id: string) => http.delete(`/posts/${id}`).then(extract),

  schedulePost: (data: { product_id: string; scheduled_at: string; text?: string; channel_override?: string; channels?: string[]; product_image?: string; affiliate_url?: string; product?: QuickPostProduct }) =>
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

// ─── Earnings API ────────────────────────────────────────────────────────────

export const earningsApi = {
  summary: (params?: { period?: '7d' | '30d' | '90d' | 'all' }) =>
    http.get<EarningsSummary>('/earnings/summary', { params }).then(extract),

  list: (params?: { page?: number; limit?: number; status?: string; from?: string; to?: string }) =>
    http.get<PaginatedResponse<Earning> & {
      totals: { amount_usd: number; commission_usd: number; commission_ils: number; count: number };
    }>('/earnings', { params }).then(extract),

  // Sync loops 4 order statuses with pacing against the AliExpress rate limit —
  // can take ~10-40s, well past the 15s global timeout.
  sync: () => http.post<{ synced: number; updated: number }>('/earnings/sync', {}, { timeout: 120_000 }).then(extract),
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
    http.post<{ ok: boolean; error?: string; page_name?: string }>(`/channels/${id}/test-facebook`).then(extract),

  /** Verify the account's Instagram Business account + linked Page token (account-global). */
  testInstagram: () =>
    http.post<{ ok: boolean; error?: string; username?: string; name?: string | null }>(`/channels/test-instagram`).then(extract),
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

  // Products
  listProducts: (catalogId?: string) =>
    http.get<SupplierProduct[]>('/suppliers/products', { params: catalogId ? { catalog_id: catalogId } : undefined }).then(extract),
  link: (data: {
    catalogId: string; yupooUrl: string; flylinkUrl: string; code?: string;
    album?: { code?: string; price?: number; currency?: string; description?: string; title?: string; images?: string[]; album_url?: string };
  }) =>
    http.post<SupplierProduct & { sku_verified: boolean }>('/suppliers/products/link', data, { timeout: 50_000 }).then(extract),
  updateProduct: (id: string, data: Partial<SupplierProduct>) =>
    http.patch<SupplierProduct>(`/suppliers/products/${id}`, data).then(extract),
  deleteProduct: (id: string) => http.delete(`/suppliers/products/${id}`).then(extract),
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
