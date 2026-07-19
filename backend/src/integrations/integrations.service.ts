import { Injectable, Logger } from '@nestjs/common';

// firebase-admin v12 uses modular subpath exports and this project has no esModuleInterop,
// so require the modular entry points directly (same pattern as sharp/form-data here).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { initializeApp, cert, getApps } = require('firebase-admin/app');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getAuth } = require('firebase-admin/auth');

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

  /** Lazily init the ClickLead Firebase Admin app. Returns null when unconfigured. */
  private clickleadAuth(): any | null {
    if (this.authInstance) return this.authInstance;
    const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
    if (!raw) return null;
    try {
      const svc = JSON.parse(raw);
      const existing = getApps().find((a: any) => a.name === 'clicklead');
      const app = existing || initializeApp({ credential: cert(svc) }, 'clicklead');
      this.authInstance = getAuth(app);
      return this.authInstance;
    } catch (e: any) {
      this.logger.error(`ClickLead Firebase Admin init failed: ${e.message}`);
      return null;
    }
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
