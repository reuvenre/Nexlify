'use client';

/**
 * Root error boundary. Replaces the whole document on an unhandled runtime error, so it
 * must render its own <html>/<body>. Kept in Hebrew/RTL to match the app instead of the
 * default LTR English Next.js error page.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="he" dir="rtl">
      {/* The whole document is replaced, the root layout's <title> with it. */}
      <head><title>משהו השתבש | Nexlify</title></head>
      <body style={{ backgroundColor: '#0d1117', color: '#fff', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0 }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>משהו השתבש</h1>
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.72)', maxWidth: '360px', margin: '0 auto 24px' }}>
              אירעה שגיאה בלתי צפויה. אפשר לנסות שוב — אם זה חוזר, רעננו את הדף או פנו לתמיכה.
            </p>
            <button
              onClick={() => reset()}
              style={{ padding: '10px 20px', borderRadius: '12px', background: '#2563eb', color: '#fff', border: 'none', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
            >
              נסה שוב
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
