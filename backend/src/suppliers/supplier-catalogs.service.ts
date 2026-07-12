import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupplierCatalog, SkuMatchMode } from './entities/supplier-catalog.entity';
import { YupooService } from './yupoo.service';
import { suggestSkuMode } from './sku-match.util';

const EDITABLE = [
  'name', 'source_type', 'source_store', 'affiliate_network',
  'sku_match_mode', 'sku_match_config', 'selectors_json',
  'target_channel_id', 'enabled',
] as const;

@Injectable()
export class SupplierCatalogsService {
  constructor(
    @InjectRepository(SupplierCatalog) private readonly repo: Repository<SupplierCatalog>,
    private readonly yupoo: YupooService,
  ) {}

  list(userId: string) {
    return this.repo.find({ where: { user_id: userId }, order: { created_at: 'DESC' } });
  }

  async get(userId: string, id: string): Promise<SupplierCatalog> {
    const cat = await this.repo.findOne({ where: { id, user_id: userId } });
    if (!cat) throw new NotFoundException('קטלוג לא נמצא');
    return cat;
  }

  async create(userId: string, dto: any): Promise<SupplierCatalog> {
    if (!dto?.name?.trim()) throw new BadRequestException('שם קטלוג חסר');
    const cat = this.repo.create({
      user_id: userId,
      name: dto.name.trim(),
      source_type: dto.source_type || 'yupoo',
      source_store: dto.source_store?.trim() || null,
      affiliate_network: dto.affiliate_network || 'flylink',
      sku_match_mode: (dto.sku_match_mode as SkuMatchMode) || 'numeric',
      sku_match_config: dto.sku_match_config || null,
      selectors_json: dto.selectors_json || null,
      target_channel_id: dto.target_channel_id?.trim() || null,
      enabled: dto.enabled !== false,
    });
    return this.repo.save(cat);
  }

  async update(userId: string, id: string, dto: any): Promise<SupplierCatalog> {
    const cat = await this.get(userId, id);
    for (const key of EDITABLE) {
      if (dto[key] !== undefined) (cat as any)[key] = dto[key];
    }
    return this.repo.save(cat);
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
  async probeStore(store: string) {
    const items = await this.yupoo.fetchStore(store);
    const sample = items[0];
    return {
      count: items.length,
      sample_code: sample?.code || null,
      suggested_mode: sample ? suggestSkuMode(sample.code) : 'exact',
      samples: items.slice(0, 5),
    };
  }
}
