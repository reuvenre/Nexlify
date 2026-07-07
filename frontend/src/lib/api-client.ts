import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import type {
  User,
  AuthResponse,
  CredentialSet,
  CredentialSetInput,
  Campaign,
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
  CatalogStatus,
  VerifyResult,
  AdBoost,
  AdsSummary,
  PerformanceRunResult,
  HuntResult,
  ValidateResult,
  AdminUser,
  AdminStats,
  SubscriptionStatus,
  PlanDef,
  BillingCycle,
} from '@/types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
const NO_REFRESH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/forgot-password', '/auth/reset-password'];

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
  login: (email: string, password: string) =>
    http.post<AuthResponse>('/auth/login', { email, password }).then(extract),

  register: (email: string, password: string) =>
    http.post<AuthResponse>('/auth/register', { email, password }).then(extract),

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

// ─── Ads / Boost API ─────────────────────────────────────────────────────────

export const adsApi = {
  list: () => http.get<AdBoost[]>('/ads').then(extract),
  summary: () => http.get<AdsSummary>('/ads/summary').then(extract),
  run: () => http.post<PerformanceRunResult>('/ads/run').then(extract),
};

// ─── Admin API ───────────────────────────────────────────────────────────────

export const adminApi = {
  users: () => http.get<AdminUser[]>('/admin/users').then(extract),
  stats: () => http.get<AdminStats>('/admin/stats').then(extract),
  setSubscription: (userId: string, plan: string, billing?: BillingCycle) =>
    http.patch<SubscriptionStatus>(`/admin/users/${userId}/subscription`, { plan, billing }).then(extract),
};

// ─── Subscription API ────────────────────────────────────────────────────────

export const subscriptionApi = {
  /** Current plan, credit balance and limits. */
  status: () => http.get<SubscriptionStatus>('/subscription').then(extract),
  /** Plan catalog — prices/credits/limits come from the backend, never hardcode. */
  plans: () => http.get<PlanDef[]>('/subscription/plans').then(extract),
  /** Demo-mode purchase: activates the plan immediately (no payment gateway yet). */
  switchPlan: (plan: string, billing: BillingCycle) =>
    http.post<SubscriptionStatus>('/subscription/switch', { plan, billing }).then(extract),
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

  runNow: (id: string) => http.post<{ queued: boolean; jobId: string }>(`/campaigns/${id}/run`).then(extract),

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

export const postsApi = {
  preview: (product_id: string, language?: string, custom_product?: Partial<AliProduct>, template?: string) =>
    http.post<PostPreview>('/posts/preview', { product_id, language, custom_product, template }, { timeout: AI_TIMEOUT }).then(extract),

  quickPost: (data: { product_id: string; text?: string; channel_override?: string; product_image?: string; affiliate_url?: string }) =>
    http.post<Post>('/posts/quick', data, { timeout: AI_TIMEOUT }).then(extract),

  list: (params?: { page?: number; limit?: number; status?: string; campaign_id?: string }) =>
    http.get<PaginatedResponse<Post>>('/posts', { params }).then(extract),

  retry: (id: string) => http.post<Post>(`/posts/${id}/retry`).then(extract),

  schedulePost: (data: { product_id: string; scheduled_at: string; text?: string; channel_override?: string; product_image?: string; affiliate_url?: string }) =>
    http.post<Post>('/posts/schedule', data, { timeout: AI_TIMEOUT }).then(extract),

  // ── Queue ──
  listQueue: () => http.get<Post[]>('/posts/queue').then(extract),
  dequeue: (id: string) => http.delete(`/posts/queue/${id}`).then(extract),
};

// ─── Earnings API ────────────────────────────────────────────────────────────

export const earningsApi = {
  summary: (params?: { period?: '7d' | '30d' | '90d' | 'all' }) =>
    http.get<EarningsSummary>('/earnings/summary', { params }).then(extract),

  list: (params?: { page?: number; limit?: number; status?: string }) =>
    http.get<PaginatedResponse<Earning>>('/earnings', { params }).then(extract),

  sync: () => http.post<{ synced: number }>('/earnings/sync').then(extract),
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

  // Re-prices the entire catalog against the AliExpress API (batched, many round-trips),
  // which easily outlasts the 15s global timeout — give it a generous window.
  resyncPrices: () =>
    http.post<{ total: number; updated: number; failed: number }>('/catalog/resync-prices', {}, { timeout: 240_000 }).then(extract),

  affiliateLink: (id: string) =>
    http.post<{ url: string }>(`/catalog/${id}/affiliate-link`).then(extract),

  queue: (id: string) =>
    http.post<Post>(`/catalog/${id}/queue`).then(extract),

  queueBatch: (ids: string[]) =>
    http.post<{ id: string; success: boolean; error?: string }[]>('/catalog/queue-batch', { ids }).then(extract),
};

export default http;
