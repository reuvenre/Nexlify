import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Coupon } from './coupon.entity';

export interface ParsedCoupon {
  code: string;
  discount_usd: number;
  min_spend_usd: number;
}

@Injectable()
export class CouponsService {
  constructor(
    @InjectRepository(Coupon) private readonly repo: Repository<Coupon>,
  ) {}

  /**
   * Words that look like a coupon code but aren't — AliExpress wording changes between
   * campaigns, so we identify the code STRUCTURALLY (an uppercase token) and reject the
   * vocabulary around it rather than relying on any one phrasing.
   */
  private static readonly STOPWORDS = new Set([
    'OFF', 'USD', 'US', 'SAVE', 'CODE', 'CODES', 'COUPON', 'COUPONS', 'GET', 'ALL', 'AND',
    'FOR', 'THE', 'MIN', 'MAX', 'OVER', 'ORDERS', 'ORDER', 'EXTRA', 'NEW', 'SALE', 'ONLY',
    'UP', 'TO', 'ON', 'WITH', 'SPEND', 'DISCOUNT', 'PROMO', 'LIMITED', 'FREE', 'SHIPPING',
    'IL', 'ILS', 'NIS', 'AM', 'PM', 'TUE', 'MON', 'WED', 'THU', 'FRI', 'SAT', 'SUN',
  ]);

  /**
   * Parse a pasted AliExpress coupon block. Deliberately format-AGNOSTIC: rather than
   * matching one phrasing, each line is scanned for (a) an uppercase code token and
   * (b) two money amounts. Handles all of these:
   *   "ILAFF1  $2 OFF $15+"        "ILAFF3 - US $7 off US $55"
   *   "ILAFF7: $55 OFF $449+"      "ILAFF2 — Save $4 on orders over $30"
   *   "$10 OFF $80+ (code: ILAFF4)"  "ILAFF5 (25$ off 209$)"
   * Non-coupon lines (titles, promo period, "---") yield no match and are skipped.
   */
  parse(text: string): ParsedCoupon[] {
    const out: ParsedCoupon[] = [];
    const seen = new Set<string>();

    for (const rawLine of (text || '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || /^[-=_*\s]+$/.test(line)) continue;

      // 1) The code FIRST: an all-caps token that isn't part of the surrounding vocabulary.
      let code = '';
      let codeIdx = -1;
      let codeLen = 0;
      const codeRe = /\b([A-Z][A-Z0-9_-]{2,31})\b/g;
      let cm: RegExpExecArray | null;
      while ((cm = codeRe.exec(line)) !== null) {
        const cand = cm[1].toUpperCase();
        if (CouponsService.STOPWORDS.has(cand)) continue;
        if (!/[A-Z]/.test(cand)) continue; // must contain a letter — never a bare number
        code = cand; codeIdx = cm.index; codeLen = cm[1].length;
        break;
      }
      if (!code) continue;

      // 2) Strip the code out before reading money. Codes end in digits ("ILAFF1"), and in
      // "ILAFF1  $2" that trailing 1 would otherwise be read as the amount "1$" — silently
      // producing a WRONG discount, which is worse than failing to parse.
      const rest = `${line.slice(0, codeIdx)} ${line.slice(codeIdx + codeLen)}`;

      // 3) Money in any notation: "$15", "US $15", "15$", "15 USD". Note the word boundary
      // belongs to USD only — "\$\b" never matches "25$ off" (space after $ isn't a boundary).
      const amounts: number[] = [];
      const amountRe = /(?:US\s*)?\$\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:\$|USD\b)/gi;
      let am: RegExpExecArray | null;
      while ((am = amountRe.exec(rest)) !== null) {
        const n = parseFloat((am[1] ?? am[2]).replace(',', '.'));
        if (Number.isFinite(n)) amounts.push(n);
      }
      if (amounts.length < 2) continue; // a coupon line always carries discount + threshold

      // A discount is always SMALLER than the spend threshold it unlocks — so regardless of
      // which order the wording puts them in, the smaller amount is the discount.
      const discount = Math.min(amounts[0], amounts[1]);
      const min = Math.max(amounts[0], amounts[1]);
      if (discount <= 0 || min <= 0 || discount >= min) continue;
      if (seen.has(code)) continue;
      seen.add(code);
      out.push({ code, discount_usd: discount, min_spend_usd: min });
    }
    return out;
  }

  /** Manually add/update one coupon — the guaranteed fallback when parsing can't cope. */
  async upsertOne(userId: string, data: {
    code: string; discount_usd: number; min_spend_usd: number;
    campaign?: string; starts_at?: string; ends_at?: string;
  }): Promise<Coupon> {
    const code = (data.code || '').trim().toUpperCase();
    if (!code) throw new BadRequestException('נא להזין קוד קופון');
    const discount = Number(data.discount_usd);
    const min = Number(data.min_spend_usd);
    if (!Number.isFinite(discount) || discount <= 0) throw new BadRequestException('סכום ההנחה חייב להיות גדול מ-0');
    if (!Number.isFinite(min) || min < 0) throw new BadRequestException('סף הקנייה לא תקין');
    if (discount >= min && min > 0) throw new BadRequestException('ההנחה חייבת להיות קטנה מסף הקנייה');

    const existing = await this.repo.findOne({ where: { user_id: userId, code } });
    const row = existing || this.repo.create({ user_id: userId, code });
    row.discount_usd = discount;
    row.min_spend_usd = min;
    row.campaign = data.campaign?.trim() || row.campaign || null;
    row.starts_at = data.starts_at ? new Date(data.starts_at) : null;
    row.ends_at = data.ends_at ? new Date(data.ends_at) : null;
    row.is_active = true;
    return this.repo.save(row);
  }

  /** Preview only — parse without saving, so the UI can show what it found. */
  preview(text: string): ParsedCoupon[] {
    return this.parse(text);
  }

  /**
   * Import a pasted block. Replaces any existing coupon with the same code for this user
   * (re-pasting an updated campaign refreshes it instead of duplicating).
   */
  async importText(userId: string, text: string, opts: {
    campaign?: string; starts_at?: string; ends_at?: string;
  }): Promise<{ imported: number; coupons: Coupon[] }> {
    const parsed = this.parse(text);
    if (!parsed.length) {
      throw new BadRequestException('לא זוהו קודי קופון בטקסט — הדבק שורות בפורמט "ILAFF1 $2 OFF $15+"');
    }
    const starts_at = opts.starts_at ? new Date(opts.starts_at) : null;
    const ends_at = opts.ends_at ? new Date(opts.ends_at) : null;
    if (starts_at && ends_at && ends_at <= starts_at) {
      throw new BadRequestException('תאריך הסיום חייב להיות אחרי תאריך ההתחלה');
    }

    const saved: Coupon[] = [];
    for (const p of parsed) {
      const existing = await this.repo.findOne({ where: { user_id: userId, code: p.code } });
      const row = existing || this.repo.create({ user_id: userId, code: p.code });
      row.discount_usd = p.discount_usd;
      row.min_spend_usd = p.min_spend_usd;
      row.campaign = opts.campaign?.trim() || row.campaign || null;
      row.starts_at = starts_at;
      row.ends_at = ends_at;
      row.is_active = true;
      saved.push(await this.repo.save(row));
    }
    return { imported: saved.length, coupons: saved };
  }

  list(userId: string): Promise<Coupon[]> {
    return this.repo.find({ where: { user_id: userId }, order: { min_spend_usd: 'ASC' } });
  }

  async remove(userId: string, id: string): Promise<{ deleted: boolean }> {
    const c = await this.repo.findOne({ where: { id, user_id: userId } });
    if (!c) throw new NotFoundException('קופון לא נמצא');
    await this.repo.remove(c);
    return { deleted: true };
  }

  async setActive(userId: string, id: string, active: boolean): Promise<Coupon> {
    const c = await this.repo.findOne({ where: { id, user_id: userId } });
    if (!c) throw new NotFoundException('קופון לא נמצא');
    c.is_active = active;
    return this.repo.save(c);
  }

  /**
   * The single best coupon for a product priced `priceUsd`: among coupons that are active,
   * inside their validity window, and whose minimum spend the price meets, return the one
   * with the LARGEST discount. Returns null when nothing qualifies (which is also what
   * makes non-AliExpress posts — priceUsd 0 — get no coupon).
   */
  async bestFor(userId: string, priceUsd: number, at: Date = new Date()): Promise<Coupon | null> {
    if (!priceUsd || priceUsd <= 0) return null;
    const rows = await this.repo
      .createQueryBuilder('c')
      .where('c.user_id = :userId', { userId })
      .andWhere('c.is_active = true')
      .andWhere('c.min_spend_usd <= :price', { price: priceUsd })
      .andWhere('(c.starts_at IS NULL OR c.starts_at <= :at)', { at })
      .andWhere('(c.ends_at IS NULL OR c.ends_at >= :at)', { at })
      .orderBy('c.discount_usd', 'DESC')
      .addOrderBy('c.min_spend_usd', 'DESC')
      .getMany();
    return rows[0] || null;
  }
}
