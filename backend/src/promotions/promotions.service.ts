import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Promotion } from './promotion.entity';
import { CREDIT_PACKS, PLANS, PlanId } from '../subscription/plans.const';

export interface PromoInput {
  title: string;
  target_type: 'plan' | 'all_plans' | 'packs';
  target_id?: string | null;
  percent_off?: number | null;
  fixed_price?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
  is_active?: boolean;
}

/** A resolved discount for one plan/pack: what the public pricing endpoints serve. */
export interface ActiveDeal {
  promo_id: string;
  title: string;
  target_type: string;
  target_id: string | null;
  percent_off: number | null;
  fixed_price: number | null;
  ends_at: string | null;
}

@Injectable()
export class PromotionsService {
  constructor(
    @InjectRepository(Promotion) private readonly repo: Repository<Promotion>,
  ) {}

  /** Validate a promo before save — bad targets/discounts must fail loudly, not silently no-op. */
  private validate(input: PromoInput): void {
    if (!input.title?.trim()) throw new BadRequestException('נא למלא כותרת למבצע');
    const hasPct = input.percent_off != null && input.percent_off !== ('' as any);
    const hasFixed = input.fixed_price != null && input.fixed_price !== ('' as any);
    if (hasPct === hasFixed) {
      throw new BadRequestException('בחר אחוז הנחה או מחיר קבוע — אחד מהם בדיוק');
    }
    if (hasPct && (input.percent_off! < 1 || input.percent_off! > 90)) {
      throw new BadRequestException('אחוז הנחה חייב להיות בין 1 ל-90');
    }
    if (hasFixed && input.fixed_price! < 1) throw new BadRequestException('מחיר מבצע לא תקין');
    if (input.target_type === 'plan' && !PLANS[input.target_id as PlanId]) {
      throw new BadRequestException('תוכנית יעד לא מוכרת');
    }
    if (input.target_type === 'packs' && input.target_id
      && !CREDIT_PACKS.some((p) => p.id === input.target_id)) {
      throw new BadRequestException('חבילת קרדיטים לא מוכרת');
    }
    if (input.starts_at && input.ends_at
      && new Date(input.ends_at) <= new Date(input.starts_at)) {
      throw new BadRequestException('תאריך הסיום חייב להיות אחרי ההתחלה');
    }
  }

  // ── Admin CRUD ──

  list() {
    return this.repo.find({ order: { created_at: 'DESC' } });
  }

  async create(input: PromoInput) {
    this.validate(input);
    const promo = this.repo.create({
      title: input.title.trim(),
      target_type: input.target_type,
      target_id: input.target_type === 'all_plans' ? null : (input.target_id || null),
      percent_off: input.percent_off ?? null,
      fixed_price: input.fixed_price ?? null,
      starts_at: input.starts_at ? new Date(input.starts_at) : null,
      ends_at: input.ends_at ? new Date(input.ends_at) : null,
      is_active: input.is_active !== false,
    });
    return this.repo.save(promo);
  }

  async update(id: string, input: Partial<PromoInput>) {
    const promo = await this.repo.findOne({ where: { id } });
    if (!promo) throw new NotFoundException('מבצע לא נמצא');
    const merged: PromoInput = {
      title: input.title ?? promo.title,
      target_type: (input.target_type ?? promo.target_type) as PromoInput['target_type'],
      target_id: input.target_id !== undefined ? input.target_id : promo.target_id,
      percent_off: input.percent_off !== undefined ? input.percent_off : promo.percent_off,
      fixed_price: input.fixed_price !== undefined ? input.fixed_price : promo.fixed_price,
      starts_at: input.starts_at !== undefined ? input.starts_at
        : (promo.starts_at ? promo.starts_at.toISOString() : null),
      ends_at: input.ends_at !== undefined ? input.ends_at
        : (promo.ends_at ? promo.ends_at.toISOString() : null),
      is_active: input.is_active ?? promo.is_active,
    };
    this.validate(merged);
    Object.assign(promo, {
      ...merged,
      title: merged.title.trim(),
      target_id: merged.target_type === 'all_plans' ? null : (merged.target_id || null),
      starts_at: merged.starts_at ? new Date(merged.starts_at) : null,
      ends_at: merged.ends_at ? new Date(merged.ends_at) : null,
    });
    return this.repo.save(promo);
  }

  async remove(id: string) {
    const promo = await this.repo.findOne({ where: { id } });
    if (!promo) throw new NotFoundException('מבצע לא נמצא');
    await this.repo.remove(promo);
    return { deleted: true };
  }

  // ── Public ──

  /** Promotions currently in their active window — what the pricing pages render. */
  async active(): Promise<ActiveDeal[]> {
    const now = new Date();
    const all = await this.repo.find({ where: { is_active: true } });
    return all
      .filter((p) => (!p.starts_at || p.starts_at <= now) && (!p.ends_at || p.ends_at > now))
      .map((p) => ({
        promo_id: p.id,
        title: p.title,
        target_type: p.target_type,
        target_id: p.target_id,
        percent_off: p.percent_off,
        fixed_price: p.fixed_price,
        ends_at: p.ends_at ? p.ends_at.toISOString() : null,
      }));
  }

  /** The promo price for a base price under a deal (rounded to whole ILS). */
  static dealPrice(base: number, deal: { percent_off: number | null; fixed_price: number | null }): number {
    if (deal.fixed_price != null) return deal.fixed_price;
    if (deal.percent_off != null) return Math.round(base * (1 - deal.percent_off / 100));
    return base;
  }
}
