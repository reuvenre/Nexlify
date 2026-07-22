import type { Metadata } from 'next';
import { MarketingShell } from '@/components/marketing/MarketingShell';

export const metadata: Metadata = {
  title: 'Privacy Policy — Nexlify',
  description: 'Privacy policy for Nexlify, the social publishing automation platform by Win-Solutions.',
  alternates: { canonical: '/privacy' },
};

/**
 * Public privacy policy. Written in English because it doubles as the policy URL
 * required by third-party developer platforms (Pinterest/Meta app review) — their
 * reviewers must be able to read it.
 */
export default function PrivacyPage() {
  return (
    <MarketingShell>
      <section className="max-w-3xl mx-auto px-6 pt-14 pb-10" dir="ltr">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">Privacy Policy</h1>
        <p className="text-sm text-white/40 mb-10">Nexlify by Win-Solutions · Last updated: July 22, 2026</p>

        <div className="space-y-8 text-[15px] leading-relaxed text-white/70">
          <div>
            <h2 className="text-lg font-semibold text-white mb-2">1. Overview</h2>
            <p>
              Nexlify (&quot;the Service&quot;) is a social publishing automation platform operated by
              Win-Solutions (&quot;we&quot;, &quot;us&quot;). It lets account owners find products, generate
              marketing content, and publish it to their own social channels — such as Telegram,
              Facebook, Instagram, WhatsApp and Pinterest. This policy explains what data we
              collect, how we use it, and the choices you have.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">2. Data we collect</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><b className="text-white/85">Account data</b> — name, email address and a hashed password when you register.</li>
              <li><b className="text-white/85">Integration credentials</b> — API keys and access tokens you provide for your own third-party accounts (e.g. a Telegram bot token, a Facebook Page token, a Pinterest access token). These are stored encrypted (AES-256) and used solely to publish and verify on your behalf.</li>
              <li><b className="text-white/85">Content data</b> — the posts, images, templates and campaign settings you create in the Service.</li>
              <li><b className="text-white/85">Usage data</b> — basic technical logs (timestamps, errors) needed to operate and debug the Service.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">3. How we use data</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>To provide the Service: creating, scheduling and publishing content to the channels you connected.</li>
              <li>To verify your integrations work (connection health checks you trigger).</li>
              <li>To secure accounts, prevent abuse and comply with legal obligations.</li>
            </ul>
            <p className="mt-2">
              We do <b className="text-white/85">not</b> sell personal data, and we do not use your data for
              third-party advertising.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">4. Third-party platforms</h2>
            <p>
              When you connect a third-party platform (Telegram, Meta/Facebook/Instagram,
              WhatsApp, Pinterest, AliExpress, Amazon), the Service accesses <b className="text-white/85">only
              your own accounts, boards, pages and channels</b>, using the credentials you provided,
              and only to perform the actions you configured (publishing posts/Pins, reading your
              own boards or pages to verify connectivity). We never access other users&apos; data on
              those platforms. Each platform&apos;s own privacy policy and terms also apply to your use
              of it.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">5. Data retention &amp; deletion</h2>
            <p>
              Your data is retained while your account is active. You can delete integration
              credentials at any time from the Settings screen, and you may request full account
              deletion by contacting us — we will remove your personal data within 30 days, except
              where retention is required by law.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">6. Cookies</h2>
            <p>
              The Service uses only essential cookies (authentication/session). We do not use
              advertising or cross-site tracking cookies.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">7. Security</h2>
            <p>
              Credentials are encrypted at rest, transport is TLS-only, and access to production
              systems is restricted. No method of storage is 100% secure, but we follow industry
              best practices to protect your data.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">8. Contact</h2>
            <p>
              Win-Solutions · <a href="mailto:rubypc6@gmail.com" className="text-blue-400 hover:underline">rubypc6@gmail.com</a>
              {' '}· <a href="https://win-solutions.co.il" className="text-blue-400 hover:underline">win-solutions.co.il</a>
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">9. Changes to this policy</h2>
            <p>
              We may update this policy from time to time; the &quot;Last updated&quot; date above reflects
              the current version. Material changes will be announced in the Service.
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
