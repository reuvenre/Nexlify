import { Injectable, Logger } from '@nestjs/common';
import { Brackets, DataSource } from 'typeorm';
import { Earning } from '../earnings/earning.entity';
import { Post } from '../posts/post.entity';

// firebase-admin v12 uses modular subpath exports and this project has no esModuleInterop,
// so require the modular entry points directly (same pattern as sharp/form-data here).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { initializeApp, cert, getApps } = require('firebase-admin/app');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getAuth } = require('firebase-admin/auth');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getFirestore } = require('firebase-admin/firestore');

/**
 * ClickLead (the user's separate landing-page system) SSO bridge.
 *
 * ClickLead authenticates with Firebase. To sign a Nexlify user straight into it we mint a
 * Firebase CUSTOM TOKEN with the Firebase Admin SDK, keyed to the SAME Firebase user (matched
 * by email), so it lands on their existing ClickLead tenant. Everything is gated behind the
 * FIREBASE_ADMIN_SERVICE_ACCOUNT env var (the ClickLead project's service-account JSON); when
 * it's absent, SSO simply returns null and the frontend opens ClickLead with its own login.
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);
  private authInstance: any = null;

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Affiliate earnings attributed to one Telegram chat, for the ClickLead ROI
   * report. A chat key is a public @username (with or without the @) or a
   * numeric -100… id — matched against the posts that were published to that
   * chat (single target or fan-out list); each earning row is already
   * attributed to its driving post by the earnings sync. Cancelled
   * commissions are excluded; date range is optional (YYYY-MM-DD, inclusive).
   */
  async earningsForChat(chatRaw: string, fromStr?: string, toStr?: string) {
    const chat = String(chatRaw || '').trim().replace(/^@/, '');
    const empty = { chat_id: chat, orders: 0, commission_usd: 0, commission_ils: 0, by_day: [] as any[] };
    if (!chat) return empty;

    const qb = this.dataSource.getRepository(Earning).createQueryBuilder('e')
      .innerJoin(Post, 'p', 'p.id = e.post_id')
      .where('e.status != :cancelled', { cancelled: 'cancelled' })
      .andWhere(new Brackets((w) => {
        w.where('p.channel_override IN (:...cands)', { cands: [chat, `@${chat}`] })
          .orWhere('p.channel_overrides LIKE :l1', { l1: `%"${chat}"%` })
          .orWhere('p.channel_overrides LIKE :l2', { l2: `%"@${chat}"%` });
      }));
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromStr || '')) {
      qb.andWhere('e.order_date >= :from', { from: new Date(`${fromStr}T00:00:00Z`) });
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(toStr || '')) {
      qb.andWhere('e.order_date < :to', { to: new Date(new Date(`${toStr}T00:00:00Z`).getTime() + 86_400_000) });
    }

    const rows = await qb.getMany();

    const orderIds = new Set<string>();
    const dayMap = new Map<string, { date: string; orders: number; commission_ils: number }>();
    let usd = 0;
    let ils = 0;
    for (const e of rows) {
      orderIds.add(e.order_id);
      usd += e.commission_usd || 0;
      ils += e.commission_ils || 0;
      const date = new Date(e.order_date).toISOString().slice(0, 10);
      const d = dayMap.get(date) || { date, orders: 0, commission_ils: 0 };
      d.orders += 1;
      d.commission_ils += e.commission_ils || 0;
      dayMap.set(date, d);
    }
    return {
      chat_id: chat,
      orders: orderIds.size,
      commission_usd: Math.round(usd * 100) / 100,
      commission_ils: Math.round(ils * 100) / 100,
      by_day: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  /** Lazily init the ClickLead Firebase Admin app. Returns null when unconfigured. */
  private clickleadApp(): any | null {
    const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
    if (!raw) return null;
    try {
      const svc = JSON.parse(raw);
      const existing = getApps().find((a: any) => a.name === 'clicklead');
      return existing || initializeApp({ credential: cert(svc) }, 'clicklead');
    } catch (e: any) {
      this.logger.error(`ClickLead Firebase Admin init failed: ${e.message}`);
      return null;
    }
  }

  private clickleadAuth(): any | null {
    if (this.authInstance) return this.authInstance;
    const app = this.clickleadApp();
    if (!app) return null;
    this.authInstance = getAuth(app);
    return this.authInstance;
  }

  /**
   * The user's ClickLead ROI summary for the Nexlify dashboard widget: their
   * tracked campaigns (ad spend + lead count from ClickLead's Firestore, read
   * with the same admin credential the SSO bridge uses) joined with the
   * commissions each campaign's chat produced here. configured:false when the
   * SSO service account isn't set up — the widget then hides itself.
   */
  async clickleadRoi(email?: string | null) {
    const app = this.clickleadApp();
    const auth = this.clickleadAuth();
    if (!app || !auth || !email) return { configured: false, campaigns: [] };

    let uid: string;
    try {
      uid = (await auth.getUserByEmail(email)).uid;
    } catch {
      return { configured: true, campaigns: [] }; // no ClickLead tenant yet
    }

    const db = getFirestore(app);
    const snap = await db.collection('tenants').doc(uid).collection('campaigns').get();
    const tracked = snap.docs
      .map((d: any) => ({ id: d.id, ...d.data() }))
      .filter((c: any) => String(c.telegramChatId || '').trim());

    const campaigns = [] as any[];
    for (const c of tracked.slice(0, 20)) {
      const [leadsAgg, earnings] = await Promise.all([
        db.collection('tenants').doc(uid).collection('leads')
          .where('campaignId', '==', c.id).count().get(),
        this.earningsForChat(c.telegramChatId),
      ]);
      const spend = Number(c.adSpend || 0);
      const revenue = earnings.commission_ils;
      campaigns.push({
        id: c.id,
        name: c.name || '',
        chat_id: earnings.chat_id,
        spend,
        leads: leadsAgg.data().count || 0,
        orders: earnings.orders,
        revenue_ils: revenue,
        roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : null,
      });
    }
    return { configured: true, campaigns };
  }

  /**
   * Mint a Firebase custom token for the user's email so ClickLead can sign them in.
   * Resolves an existing Firebase user by email (creating one if none), which unifies the
   * identity with any prior Google sign-in that used the same email. Returns null when the
   * service account isn't configured yet.
   */
  async clickleadSsoToken(email?: string | null): Promise<string | null> {
    const auth = this.clickleadAuth();
    if (!auth || !email) return null;
    let uid: string;
    try {
      uid = (await auth.getUserByEmail(email)).uid;
    } catch {
      uid = (await auth.createUser({ email })).uid;
    }
    return auth.createCustomToken(uid, { via: 'nexlify' });
  }

  /** The ClickLead base URL (overridable via env). */
  get clickleadUrl(): string {
    return (process.env.CLICKLEAD_URL || 'https://clicklead.win-solutions.co.il').replace(/\/$/, '');
  }
}
