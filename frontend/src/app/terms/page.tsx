import type { Metadata } from 'next';
import { MarketingShell } from '@/components/marketing/MarketingShell';

export const metadata: Metadata = {
  title: 'Terms of Service — Nexlify',
  description: 'Terms of Service for Nexlify, the social publishing automation platform by Win-Solutions.',
  alternates: { canonical: '/terms' },
};

/**
 * Public Terms of Service. English (doubles as the ToS URL required by Meta/Google app
 * review). Company registration details are marked [TODO] — fill in the legal entity name,
 * business number (ח.פ/ע.מ) and address before public launch.
 */
export default function TermsPage() {
  return (
    <MarketingShell>
      <section className="max-w-3xl mx-auto px-6 pt-14 pb-10" dir="ltr" lang="en">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">Terms of Service</h1>
        <p className="text-sm text-white/40 mb-10">Nexlify by Win-Solutions · Last updated: July 27, 2026</p>

        <div className="space-y-8 text-[15px] leading-relaxed text-white/70">
          <div>
            <h2 className="text-lg font-semibold text-white mb-2">1. Agreement</h2>
            <p>
              These Terms of Service (&quot;Terms&quot;) govern your access to and use of Nexlify
              (&quot;the Service&quot;), operated by Win-Solutions{' '}
              {/* TODO: insert registered legal entity + business number (ח.פ/ע.מ) + address */}
              (&quot;we&quot;, &quot;us&quot;). By creating an account or using the Service you agree to these
              Terms. If you do not agree, do not use the Service.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">2. The Service</h2>
            <p>
              Nexlify helps account owners find products, generate marketing content with AI, and
              publish it to their own connected channels (such as Telegram, Facebook, Instagram,
              WhatsApp and Pinterest), and measure clicks and commissions. You are responsible for
              the content you publish and for complying with the terms of every third-party
              platform and affiliate network you connect.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">3. Accounts</h2>
            <p>
              You must provide accurate information, keep your credentials secure, and are
              responsible for all activity under your account. You must be at least 18 years old
              and legally able to enter a contract. We may suspend or terminate accounts that
              violate these Terms or applicable law.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">4. Plans, Credits &amp; Billing</h2>
            <p>
              The Service offers a free tier and paid subscription plans billed monthly or annually.
              Paid plans and credit packs are charged in advance. Publishing and AI generation
              consume credits from your plan&apos;s monthly allowance; unused monthly credits do not
              roll over. Prices are shown in ILS and may change with prior notice; changes do not
              affect the current paid period.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">5. Cancellation &amp; Refunds</h2>
            <p>
              You may cancel your subscription at any time; cancellation stops the next renewal and
              your plan remains active until the end of the paid period. Consumer cancellation
              rights under the Israeli Consumer Protection Law (including the statutory cooling-off
              period for online and continuous-service transactions) apply where applicable. To
              cancel or request a refund, contact us at the address in section 10.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">6. Acceptable Use</h2>
            <p>
              You may not use the Service to publish unlawful, deceptive, infringing or spam
              content, to abuse third-party platforms, to attempt to breach security or rate
              limits, or to resell the Service without our written consent. We may remove content
              or suspend access to protect the Service or comply with law.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">7. Third-Party Services</h2>
            <p>
              The Service integrates with third parties (e.g. AliExpress affiliate, Telegram, Meta,
              Google). Your use of those services is governed by their terms, and their
              availability is outside our control. Affiliate earnings are determined by the
              respective networks, not by us.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">8. Disclaimers &amp; Liability</h2>
            <p>
              The Service is provided &quot;as is&quot; without warranties of any kind. We do not
              guarantee any level of sales, earnings, deliverability or uninterrupted availability.
              To the maximum extent permitted by law, our aggregate liability is limited to the
              amount you paid us in the three months preceding the claim.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">9. Governing Law</h2>
            <p>
              These Terms are governed by the laws of the State of Israel, and the competent courts
              of Israel have exclusive jurisdiction, without regard to conflict-of-law rules.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white mb-2">10. Contact</h2>
            <p>
              Questions about these Terms, cancellations or refunds: Win-Solutions,{' '}
              <a href="https://win-solutions.co.il" className="text-amber-400 hover:text-amber-300 underline">win-solutions.co.il</a>.
              {' '}{/* TODO: replace with a branded support email, e.g. support@nexlify.win-solutions.co.il */}
            </p>
          </div>

          <p className="text-sm text-white/40">
            See also our{' '}
            <a href="/privacy" className="text-amber-400 hover:text-amber-300 underline">Privacy Policy</a>.
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
