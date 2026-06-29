'use client';

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { setAccessToken, setRefreshToken } from '@/lib/api-client';

export default function GoogleSuccessPage() {
  useEffect(() => {
    // The backend handed the tokens back in the URL fragment (#…), which never reaches
    // a server. Persist them, scrub the URL, then hard-redirect into the app — where
    // bootstrap() picks up the stored session (the cross-domain cookie is blocked).
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const params = new URLSearchParams(hash);
    const access = params.get('access_token');
    const refresh = params.get('refresh_token');

    if (access) setAccessToken(access);
    if (refresh) setRefreshToken(refresh);

    // Remove the tokens from the address bar / history.
    window.history.replaceState(null, '', '/google/success');

    window.location.replace(access ? '/dashboard' : '/login?error=google_failed');
  }, []);

  return (
    <div className="min-h-screen bg-surface-primary flex items-center justify-center">
      <Loader2 size={28} className="animate-spin text-blue-400" />
    </div>
  );
}
