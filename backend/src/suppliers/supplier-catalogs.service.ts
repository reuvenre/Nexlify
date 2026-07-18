import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupplierCatalog, SkuMatchMode } from './entities/supplier-catalog.entity';
import { YupooService } from './yupoo.service';
import { suggestSkuMode } from './sku-match.util';
import { RatesService } from '../rates/rates.service';
import { CredentialsService } from '../credentials/credentials.service';
import { encrypt, decrypt } from '../common/crypto';

const EDITABLE = [
  'name', 'source_type', 'source_store', 'affiliate_network',
  'sku_match_mode', 'sku_match_config', 'selectors_json',
  'target_channel_id', 'enabled',
] as const;

/** Accept a full Yupoo URL or a bare slug → store just the slug. */
function toStoreSlug(input?: string): string {
  const s = (input || '').trim();
  if (!s) return s;
  const m = s.match(/^https?:\/\/([^./]+)\.x\.yupoo\.com/i);
  return m ? m[1] : s.replace(/^https?:\/\//, '').split(/[./]/)[0];
}

@Injectable()
export class SupplierCatalogsService {
  constructor(
    @InjectRepository(SupplierCatalog) private readonly repo: Repository<SupplierCatalog>,
    private readonly yupoo: YupooService,
    private readonly rates: RatesService,
    private readonly credentials: CredentialsService,
  ) {}

  /** Never leak the encrypted secrets to the API; expose only whether a password is set. */
  private toPublic(cat: SupplierCatalog) {
    const { password_enc, flylink_api_token_enc, ...rest } = cat as any;
    return { ...rest, has_password: !!password_enc };
  }

  /** The catalog's Yupoo password (decrypted) for server-side fetches, or undefined. */
  catalogPassword(cat: SupplierCatalog): string | undefined {
    return cat.password_enc ? decrypt(cat.password_enc) : undefined;
  }

  async list(userId: string) {
    const cats = await this.repo.find({ where: { user_id: userId }, order: { created_at: 'DESC' } });
    return cats.map((c) => this.toPublic(c));
  }

  /** Internal: the raw entity (with encrypted secrets) for server-side use. */
  async get(userId: string, id: string): Promise<SupplierCatalog> {
    const cat = await this.repo.findOne({ where: { id, user_id: userId } });
    if (!cat) throw new NotFoundException('קטלוג לא נמצא');
    return cat;
  }

  async create(userId: string, dto: any): Promise<any> {
    if (!dto?.name?.trim()) throw new BadRequestException('שם קטלוג חסר');
    const cat = this.repo.create({
      user_id: userId,
      name: dto.name.trim(),
      source_type: dto.source_type || 'yupoo',
      source_store: toStoreSlug(dto.source_store) || null,
      affiliate_network: dto.affiliate_network || 'flylink',
      sku_match_mode: (dto.sku_match_mode as SkuMatchMode) || 'numeric',
      sku_match_config: dto.sku_match_config || null,
      selectors_json: dto.selectors_json || null,
      target_channel_id: dto.target_channel_id?.trim() || null,
      password_enc: dto.password?.trim() ? encrypt(dto.password.trim()) : null,
      enabled: dto.enabled !== false,
    });
    return this.toPublic(await this.repo.save(cat));
  }

  async update(userId: string, id: string, dto: any): Promise<any> {
    const cat = await this.get(userId, id);
    for (const key of EDITABLE) {
      if (dto[key] !== undefined) (cat as any)[key] = dto[key];
    }
    if (dto.source_store !== undefined) cat.source_store = toStoreSlug(dto.source_store) || null;
    // A non-empty password sets/replaces it; an explicit empty string clears it (back to public).
    if (dto.password !== undefined) {
      cat.password_enc = dto.password?.trim() ? encrypt(dto.password.trim()) : null;
    }
    return this.toPublic(await this.repo.save(cat)) as any;
  }

  async remove(userId: string, id: string) {
    const cat = await this.get(userId, id);
    await this.repo.remove(cat);
    return { deleted: true };
  }

  /**
   * Fetch a sample from the store and suggest a match mode — used by the "add
   * catalog" screen so the user gets a sensible default for the code format.
   */
  async probeStore(store: string, password?: string) {
    const { items } = await this.yupoo.fetchStore(store, { password: password?.trim() || undefined });
    const sample = items[0];
    return {
      count: items.length,
      sample_code: sample?.code || null,
      suggested_mode: sample ? suggestSkuMode(sample.code) : 'exact',
      samples: items.slice(0, 5),
    };
  }

  /** Browse a catalog's store from inside the app (categories + paginated albums). */
  async browse(userId: string, catalogId: string, opts: { page?: number; categoryId?: string; withCategories?: boolean }) {
    const cat = await this.get(userId, catalogId);
    if (!cat.source_store) throw new BadRequestException('לא הוגדרה חנות Yupoo לקטלוג');
    const pw = this.catalogPassword(cat);
    const [page, categories, creds] = await Promise.all([
      this.yupoo.fetchStore(cat.source_store, { page: opts.page, categoryId: opts.categoryId, password: pw }),
      opts.withCategories ? this.yupoo.fetchCategories(cat.source_store, pw) : Promise.resolve(undefined),
      this.credentials.getRaw(userId),
    ]);
    // Convert store prices (USD) to the user's currency so the browser shows ₪ like the rest.
    const pair = creds?.currency_pair || 'USD_ILS';
    const rate = (await this.rates.getRate(pair)) || 1;
    const currency = pair.split('_')[1] || 'ILS';
    const items = page.items.map((it) => ({ ...it, price: +((it.price || 0) * rate).toFixed(2), currency }));
    return { ...page, items, categories };
  }
}
