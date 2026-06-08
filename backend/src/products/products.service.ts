import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import axios from 'axios';
import { CredentialsService, DecryptedCredentials } from '../credentials/credentials.service';
import { RatesService } from '../rates/rates.service';
import { signAliexpress } from '../common/aliexpress-sign';

const ALI_API = 'https://api-sg.aliexpress.com/sync';

// target_sale_price / target_original_price = AliExpress's own converted price in the
// requested target_currency — this matches what users see on the website.
// sale_price / original_price stay as USD fallback.
const PRODUCT_FIELDS =
  'product_id,product_title,original_price,sale_price,' +
  'target_original_price,target_sale_price,target_sale_price_currency,' +
  'discount,product_main_image_url,' +
  'product_detail_url,evaluate_rate,first_level_category_name,lastest_volume,' +
  'commission_rate,hot_product_commission_rate';

const HOT_FIELDS =
  'product_id,product_title,original_price,sale_price,' +
  'target_original_price,target_sale_price,target_sale_price_currency,' +
  'discount,product_main_image_url,' +
  'product_detail_url,evaluate_rate,first_level_category_name,lastest_volume,' +
  'promotion_type,hot_product_commission_rate';

const CATEGORIES_TTL_SEC = 24 * 60 * 60; // 24 hours

const DEFAULT_FEATURED_KEYWORDS = ['electronics', 'fashion', 'home gadgets', 'phone accessories'];

export const CURRENCY_SYMBOLS: Record<string, string> = {
  ILS: '₪', EUR: '€', GBP: '£', USD: '$',
};

function targetCurrency(currencyPair: string): string {
  return (currencyPair || 'USD_ILS').split('_')[1] || 'ILS';
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly credentials: CredentialsService,
    private readonly rates: RatesService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  // ── Search ────────────────────────────────────────────────────────────────

  async search(userId: string, params: {
    keyword: string;
    category_id?: string;
    min_price?: number;
    max_price?: number;
    min_discount?: number;
    sort?: string;
    page?: number;
    limit?: number;
  }) {
    const creds = await this.credentials.getRaw(userId);
    const page = params.page || 1;
    const limit = Math.min(params.limit || 30, 50);
    const currency = targetCurrency(creds?.currency_pair || 'USD_ILS');
    const rate = await this.rates.getRate(creds?.currency_pair || 'USD_ILS');

    if (!creds?.aliexpress_app_key) {
      this.logger.warn(`search: no AliExpress credentials for user ${userId} — returning mock data`);
      const data = this.mockProducts(params.keyword, limit, currency, rate);
      return { data, total: data.length, page, limit };
    }

    try {
      const signed = signAliexpress({
        method: 'aliexpress.affiliate.product.query',
        app_key: creds.aliexpress_app_key,
        keywords: params.keyword,
        category_ids: params.category_id,
        min_sale_price: params.min_price ? Math.round(params.min_price / rate * 100) : undefined,
        max_sale_price: params.max_price ? Math.round(params.max_price / rate * 100) : undefined,
        fields: PRODUCT_FIELDS,
        page_no: page,
        page_size: limit,
        sort: params.sort,
        target_currency: currency,
        tracking_id: creds.aliexpress_tracking_id,
      }, creds.aliexpress_app_secret);

      const res = await axios.get(ALI_API, { params: signed, timeout: 12000 });
      const respResult = res.data?.aliexpress_affiliate_product_query_response?.resp_result;
      if (respResult?.resp_code !== 200) {
        this.logger.error(`AliExpress search API error: code=${respResult?.resp_code} msg=${respResult?.resp_msg}`);
      }
      const result = respResult?.result;
      const items = result?.products?.product || [];
      const total = result?.total_record_count || items.length;

      const data = this.mapProducts(items, rate, currency);

      const filtered = params.min_discount
        ? data.filter((p) => p.discount_percent >= params.min_discount!)
        : data;

      return { data: filtered, total, page, limit };
    } catch (err: any) {
      this.logger.error(`AliExpress search failed: ${err?.response?.data ? JSON.stringify(err.response.data) : err?.message}`);
      const data = this.mockProducts(params.keyword, limit, currency, rate);
      return { data, total: data.length, page, limit };
    }
  }

  // ── Featured / auto-loaded products ──────────────────────────────────────

  async getFeatured(userId: string, params: {
    category_id?: string;
    sort?: 'best_selling' | 'most_discounted';
    page?: number;
    limit?: number;
  }) {
    const creds = await this.credentials.getRaw(userId);
    const page = params.page || 1;
    const limit = Math.min(params.limit || 30, 50);
    const currency = targetCurrency(creds?.currency_pair || 'USD_ILS');
    const rate = await this.rates.getRate(creds?.currency_pair || 'USD_ILS');

    const keyword = params.category_id
      ? ''
      : DEFAULT_FEATURED_KEYWORDS[Math.floor(Math.random() * DEFAULT_FEATURED_KEYWORDS.length)];

    const sort = params.sort === 'most_discounted' ? 'SALE_PRICE_ASC' : 'LAST_VOLUME_DESC';
    const minDiscount = params.sort === 'most_discounted' ? 30 : undefined;

    if (!creds?.aliexpress_app_key) {
      this.logger.warn(`getFeatured: no AliExpress credentials for user ${userId} — returning mock data`);
      const label = params.sort === 'most_discounted' ? 'deal' : 'trending';
      const data = this.mockProducts(label, limit, currency, rate);
      return { data, total: data.length, page, limit };
    }

    try {
      const signed = signAliexpress({
        method: 'aliexpress.affiliate.product.query',
        app_key: creds.aliexpress_app_key,
        keywords: keyword || undefined,
        category_ids: params.category_id,
        fields: PRODUCT_FIELDS,
        page_no: page,
        page_size: limit,
        sort,
        target_currency: currency,
        tracking_id: creds.aliexpress_tracking_id,
      }, creds.aliexpress_app_secret);

      const res = await axios.get(ALI_API, { params: signed, timeout: 12000 });
      const respResult = res.data?.aliexpress_affiliate_product_query_response?.resp_result;
      if (respResult?.resp_code !== 200) {
        this.logger.error(`AliExpress featured API error: code=${respResult?.resp_code} msg=${respResult?.resp_msg}`);
      }
      const result = respResult?.result;
      const items = result?.products?.product || [];
      const total = result?.total_record_count || items.length;

      let data = this.mapProducts(items, rate, currency);
      if (minDiscount) data = data.filter((p) => p.discount_percent >= minDiscount);

      return { data, total, page, limit };
    } catch (err: any) {
      this.logger.error(`AliExpress featured failed: ${err?.response?.data ? JSON.stringify(err.response.data) : err?.message}`);
      const label = params.sort === 'most_discounted' ? 'deal' : 'trending';
      const data = this.mockProducts(label, limit, currency, rate);
      return { data, total: data.length, page, limit };
    }
  }

  // ── Promotional products (active AliExpress campaigns) ────────────────────

  async getPromotional(userId: string, params: {
    category_id?: string;
    page?: number;
    limit?: number;
  }) {
    const creds = await this.credentials.getRaw(userId);
    const page = params.page || 1;
    const limit = Math.min(params.limit || 30, 50);
    const currency = targetCurrency(creds?.currency_pair || 'USD_ILS');
    const rate = await this.rates.getRate(creds?.currency_pair || 'USD_ILS');

    if (!creds?.aliexpress_app_key) {
      this.logger.warn(`getPromotional: no AliExpress credentials for user ${userId} — returning mock data`);
      const data = this.mockProducts('promotion', limit, currency, rate);
      return { data, total: data.length, page, limit };
    }

    try {
      const signed = signAliexpress({
        method: 'aliexpress.affiliate.hotproduct.query',
        app_key: creds.aliexpress_app_key,
        category_ids: params.category_id,
        fields: HOT_FIELDS,
        page_no: page,
        page_size: limit,
        sort: 'LAST_VOLUME_DESC',
        target_currency: currency,
        tracking_id: creds.aliexpress_tracking_id,
      }, creds.aliexpress_app_secret);

      const res = await axios.get(ALI_API, { params: signed, timeout: 12000 });
      const respResult = res.data?.aliexpress_affiliate_hotproduct_query_response?.resp_result;
      if (respResult?.resp_code !== 200) {
        this.logger.error(`AliExpress promotional API error: code=${respResult?.resp_code} msg=${respResult?.resp_msg}`);
      }
      const result = respResult?.result;
      const items = result?.products?.product || [];
      const total = result?.total_record_count || items.length;

      const data = this.mapProducts(items, rate, currency);
      return { data, total, page, limit };
    } catch (err: any) {
      this.logger.error(`AliExpress promotional failed: ${err?.response?.data ? JSON.stringify(err.response.data) : err?.message}`);
      const data = this.mockProducts('promotion', limit, currency, rate);
      return { data, total: data.length, page, limit };
    }
  }

  // ── Categories ────────────────────────────────────────────────────────────

  async getCategories(userId: string) {
    const cacheKey = `categories:${userId}`;
    const cached = await this.cacheManager.get<any[]>(cacheKey);
    if (cached) return cached;

    const creds = await this.credentials.getRaw(userId);
    if (!creds?.aliexpress_app_key) {
      return this.mockCategories();
    }

    try {
      const signed = signAliexpress({
        method: 'aliexpress.affiliate.category.get',
        app_key: creds.aliexpress_app_key,
      }, creds.aliexpress_app_secret);

      const res = await axios.get(ALI_API, { params: signed, timeout: 12000 });
      const items: any[] =
        res.data?.aliexpress_affiliate_category_get_response?.resp_result?.result?.categories?.category || [];

      const categories = items
        .filter((c) => !c.parent_category_id || c.parent_category_id === '0')
        .map((c) => ({
          id: String(c.category_id),
          name: c.category_name,
          parent_id: c.parent_category_id ? String(c.parent_category_id) : null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      await this.cacheManager.set(cacheKey, categories, CATEGORIES_TTL_SEC * 1000);
      return categories;
    } catch (err: any) {
      this.logger.error(`AliExpress categories failed: ${err?.response?.data ? JSON.stringify(err.response.data) : err?.message}`);
      return this.mockCategories();
    }
  }

  // ── Refresh single product price ─────────────────────────────────────────

  async refreshPrice(userId: string, productId: string) {
    const creds = await this.credentials.getRaw(userId);
    const currency = targetCurrency(creds?.currency_pair || 'USD_ILS');
    const rate = await this.rates.getRate(creds?.currency_pair || 'USD_ILS');

    if (!creds?.aliexpress_app_key) return null;

    try {
      const signed = signAliexpress({
        method: 'aliexpress.affiliate.product.query',
        app_key: creds.aliexpress_app_key,
        keywords: productId,
        fields: PRODUCT_FIELDS,
        page_size: 20,
        target_currency: currency,
        tracking_id: creds.aliexpress_tracking_id,
      }, creds.aliexpress_app_secret);

      const res = await axios.get(ALI_API, { params: signed, timeout: 8000 });
      const items: any[] =
        res.data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product || [];

      // Require an exact product_id match — never fall back to items[0],
      // as a keyword search for a numeric ID can return completely unrelated products.
      const exact = items.find((p: any) => String(p.product_id) === productId);
      if (!exact) return null;

      return this.mapProducts([exact], rate, currency)[0];
    } catch {
      return null;
    }
  }

  // ── Affiliate link ────────────────────────────────────────────────────────

  async affiliateLink(userId: string, productId: string): Promise<{ url: string }> {
    const creds = await this.credentials.getRaw(userId);
    if (!creds?.aliexpress_app_key) {
      return { url: `https://www.aliexpress.com/item/${productId}.html` };
    }

    try {
      const signed = signAliexpress({
        method: 'aliexpress.affiliate.link.generate',
        app_key: creds.aliexpress_app_key,
        source_values: `https://www.aliexpress.com/item/${productId}.html`,
        promotion_link_type: '0',
        tracking_id: creds.aliexpress_tracking_id,
      }, creds.aliexpress_app_secret);

      const res = await axios.get(ALI_API, { params: signed, timeout: 10000 });
      const links = res.data?.aliexpress_affiliate_link_generate_response?.resp_result?.result?.promotion_links?.promotion_link;
      return { url: links?.[0]?.promotion_link || `https://www.aliexpress.com/item/${productId}.html` };
    } catch {
      return { url: `https://www.aliexpress.com/item/${productId}.html` };
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private mapProducts(items: any[], rate: number, currency: string) {
    return items.map((p: any) => {
      const usdSale = parseFloat(p.sale_price) || 0;
      const usdOrig = parseFloat(p.original_price) || 0;

      // Prefer AliExpress's own converted price (matches website exactly).
      // Fall back to manual conversion only when target_sale_price is absent.
      const targetSale = parseFloat(p.target_sale_price);
      const targetOrig = parseFloat(p.target_original_price);
      const resolvedCurrency = p.target_sale_price_currency || currency;

      const finalSale = targetSale > 0 ? targetSale : +(usdSale * rate).toFixed(2);
      const finalOrig = targetOrig > 0 ? targetOrig : +(usdOrig * rate).toFixed(2);

      // evaluate_rate is a 0-100 positive-review percentage (e.g. "96.7" or "96.7%").
      // Convert to a 0-5 star rating so it matches what AliExpress shows on product pages.
      const rawEval = String(p.evaluate_rate || '').replace('%', '').trim();
      const evalPct = parseFloat(rawEval) || 0;
      const rating  = evalPct > 5 ? +(evalPct / 20).toFixed(1) : +evalPct.toFixed(1);

      // lastest_volume is the recent sales count exposed by the Affiliate API.
      // Parse as an integer; AliExpress product pages may show a higher cumulative total.
      const ordersCount = parseInt(String(p.lastest_volume || '0').replace(/,/g, ''), 10) || 0;

      // commission_rate / hot_product_commission_rate come back as percentage strings (e.g. "5.00%").
      const rawCommission = String(p.commission_rate || p.hot_product_commission_rate || '').replace('%', '').trim();
      const commissionRate = parseFloat(rawCommission) || 0;

      return {
        product_id: String(p.product_id),
        title: p.product_title,
        original_price: +finalOrig.toFixed(2),
        sale_price: +finalSale.toFixed(2),
        discount_percent: parseInt(p.discount) || 0,
        image_url: p.product_main_image_url,
        product_url: p.product_detail_url,
        category: p.first_level_category_name,
        orders_count: ordersCount,
        rating,
        currency: resolvedCurrency,
        sale_price_usd: +usdSale.toFixed(2),
        commission_rate: commissionRate,
      };
    });
  }

  private mockCategories() {
    return [
      { id: '44', name: 'Electronics', parent_id: null },
      { id: '3', name: 'Phones & Accessories', parent_id: null },
      { id: '6', name: 'Computer & Networking', parent_id: null },
      { id: '13', name: 'Fashion', parent_id: null },
      { id: '15', name: "Women's Clothing", parent_id: null },
      { id: '11', name: "Men's Clothing", parent_id: null },
      { id: '66', name: 'Jewelry & Watches', parent_id: null },
      { id: '1501', name: 'Home & Garden', parent_id: null },
      { id: '34', name: 'Consumer Electronics', parent_id: null },
      { id: '36', name: 'Sports & Entertainment', parent_id: null },
      { id: '18', name: 'Beauty & Health', parent_id: null },
      { id: '39', name: 'Bags & Shoes', parent_id: null },
      { id: '26', name: 'Toys & Hobbies', parent_id: null },
      { id: '7', name: 'Office & School Supplies', parent_id: null },
      { id: '100003070', name: 'Automobiles & Motorcycles', parent_id: null },
    ];
  }

  private mockProducts(keyword: string, limit: number, currency = 'USD', rate = 1) {
    return Array.from({ length: limit }, (_, i) => {
      const usdSale = 9.99 + i * 1.5;
      const usdOrig = 19.99 + i * 3;
      return {
        product_id: `mock-${Date.now()}-${i}`,
        title: `${keyword} Item ${i + 1} — Premium Quality`,
        original_price: +(usdOrig * rate).toFixed(2),
        sale_price: +(usdSale * rate).toFixed(2),
        discount_percent: Math.floor(30 + (i % 5) * 8),
        image_url: `https://ae01.alicdn.com/kf/placeholder${i % 5}.jpg`,
        product_url: `https://www.aliexpress.com/item/mock${i}.html`,
        category: 'General',
        orders_count: 500 + i * 120,
        rating: +(4.2 + (i % 5) * 0.15).toFixed(1),
        currency,
        sale_price_usd: +usdSale.toFixed(2),
        commission_rate: +(3 + (i % 6)).toFixed(1),
      };
    });
  }
}
