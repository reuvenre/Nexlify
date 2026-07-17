'use client';

import { useState, useEffect } from 'react';
import { Eye, EyeOff, CheckCircle2, XCircle, Loader2, Save, Plus, Trash2 } from 'lucide-react';
import { credentialsApi, channelsApi } from '@/lib/api-client';
import type { Channel } from '@/types';

export function IntegrationsForm() {
  const [botToken, setBotToken] = useState('');
  const [defaultChannel, setDefaultChannel] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [telegramOk, setTelegramOk] = useState<boolean | null>(null);

  // Facebook / Meta
  const [fbPageId, setFbPageId] = useState('');
  const [fbToken, setFbToken] = useState('');
  const [showFbToken, setShowFbToken] = useState(false);
  const [metaAdAccount, setMetaAdAccount] = useState('');
  const [pubTelegram, setPubTelegram] = useState(true);
  const [pubFacebook, setPubFacebook] = useState(false);
  const [facebookOk, setFacebookOk] = useState<boolean | null>(null);
  const [facebookError, setFacebookError] = useState<string | null>(null);
  const [adAccountOk, setAdAccountOk] = useState<boolean | null>(null);
  const [adAccountError, setAdAccountError] = useState<string | null>(null);

  // Instagram (reuses the Facebook Page token)
  const [igBusinessId, setIgBusinessId] = useState('');
  const [pubInstagram, setPubInstagram] = useState(false);
  const [instagramOk, setInstagramOk] = useState<boolean | null>(null);
  const [instagramError, setInstagramError] = useState<string | null>(null);

  // Auto image enhancement (local sharp pass, applied on the Telegram album)
  const [imageEnhance, setImageEnhance] = useState(false);

  // Make.com webhook relay (delivers Facebook via the user's own Make scenario)
  const [makeUrl, setMakeUrl] = useState('');
  const [pubViaMake, setPubViaMake] = useState(false);

  // Scaffolded integrations (credentials stored; activation pending external accounts)
  const [waPhoneId, setWaPhoneId] = useState('');
  const [waToken, setWaToken] = useState('');
  const [pinBoardId, setPinBoardId] = useState('');
  const [pinToken, setPinToken] = useState('');

  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);

  useEffect(() => {
    credentialsApi.get()
      .then((c) => {
        setDefaultChannel(c.telegram_channel_id || '');
        setFbPageId(c.facebook_page_id || '');
        setMetaAdAccount(c.meta_ad_account_id || '');
        setIgBusinessId(c.instagram_business_id || '');
        setPubTelegram(c.publish_telegram ?? true);
        setPubFacebook(c.publish_facebook ?? false);
        setPubInstagram(c.publish_instagram ?? false);
        setImageEnhance(c.image_enhance_enabled ?? false);
        setMakeUrl(c.make_webhook_url || '');
        setPubViaMake(c.publish_via_make ?? false);
        setWaPhoneId(c.whatsapp_phone_number_id || '');
        setPinBoardId(c.pinterest_board_id || '');
      })
      .catch(() => {});

    channelsApi.list()
      .then(setChannels)
      .catch(() => {})
      .finally(() => setLoadingChannels(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await credentialsApi.upsert({
        aliexpress_app_key: '',
        aliexpress_app_secret: '',
        aliexpress_tracking_id: '',
        telegram_bot_token: botToken,
        telegram_channel_id: defaultChannel,
        openai_api_key: '',
        facebook_page_id: fbPageId,
        facebook_page_token: fbToken,
        meta_ad_account_id: metaAdAccount,
        instagram_business_id: igBusinessId,
        publish_telegram: pubTelegram,
        publish_facebook: pubFacebook,
        publish_instagram: pubInstagram,
        image_enhance_enabled: imageEnhance,
        make_webhook_url: makeUrl,
        publish_via_make: pubViaMake,
        whatsapp_phone_number_id: waPhoneId,
        whatsapp_access_token: waToken,
        pinterest_board_id: pinBoardId,
        pinterest_access_token: pinToken,
      });
      setWaToken(''); setPinToken('');
      setSaved(true);
      setBotToken('');
      setFbToken('');
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      // verify() checks the SAVED credentials, not what's currently typed. If the user
      // pasted a new token/bot secret but hasn't saved, persist it first — otherwise the
      // check runs against the old saved state and confusingly reports "not entered".
      if (fbToken.trim() || botToken.trim()) {
        await handleSave();
      }
      const res = await credentialsApi.verify();
      setTelegramOk(res.telegram);
      setFacebookOk(res.facebook);
      setFacebookError(res.facebook ? null : res.errors?.facebook || null);
      setInstagramOk(res.instagram);
      setInstagramError(res.instagram ? null : res.errors?.instagram || null);
      setAdAccountOk(res.metaAdAccount);
      setAdAccountError(res.metaAdAccount ? null : res.errors?.metaAdAccount || null);
    } finally {
      setVerifying(false);
    }
  };

  const handleDeleteChannel = async (id: string) => {
    if (!confirm('למחוק את הערוץ?')) return;
    await channelsApi.delete(id).catch(() => {});
    setChannels((cs) => cs.filter((c) => c.id !== id));
  };

  return (
    <div className="space-y-6">
      {/* Default Telegram Bot */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <span className="text-lg">📨</span> Telegram Bot ראשי
          {telegramOk !== null && (
            telegramOk
              ? <CheckCircle2 size={13} className="text-emerald-400" />
              : <XCircle size={13} className="text-red-400" />
          )}
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Bot Token</label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="השאר ריק לשמור על הנוכחי"
                className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 pr-10 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
                dir="ltr"
              />
              <button type="button" onClick={() => setShowToken((s) => !s)}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-white/30 hover:text-white/60">
                {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            <p className="text-2xs text-white/25 mt-1">מ-@BotFather · ממולא רק בעת עדכון</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">ערוץ ברירת מחדל</label>
            <input
              value={defaultChannel}
              onChange={(e) => setDefaultChannel(e.target.value)}
              placeholder="@mychannel או -100123456789"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
              dir="ltr"
            />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saved ? 'נשמר ✓' : saving ? 'שומר...' : 'שמור'}
          </button>
          <button onClick={handleVerify} disabled={verifying}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-60 text-white/60 text-sm rounded-xl transition-all">
            {verifying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            בדוק חיבור
          </button>
        </div>
      </section>

      {/* WhatsApp Business — credentials stored; activation pending a WhatsApp Business
          Account + Meta-approved message templates. */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="text-lg">💬</span> WhatsApp Business
          </h3>
          <span className="text-2xs bg-blue-500/15 text-blue-300 border border-blue-500/25 rounded-full px-2.5 py-0.5 font-medium">דרוש חשבון WhatsApp Business</span>
        </div>
        <p className="text-xs text-white/35 mb-4">
          שמור כאן את פרטי WhatsApp Cloud API. הפרסום יופעל לאחר שיהיה לך WhatsApp Business Account עם תבניות הודעה מאושרות ע&quot;י Meta.
        </p>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Phone Number ID</label>
            <input value={waPhoneId} onChange={(e) => setWaPhoneId(e.target.value)} placeholder="1050000000000000" dir="ltr"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50" />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Access Token</label>
            <input value={waToken} onChange={(e) => setWaToken(e.target.value)} type="password" placeholder="EAAG..." dir="ltr"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50" />
          </div>
        </div>
      </section>

      {/* Pinterest — credentials stored; activation pending a Pinterest app + API access. */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="text-lg">📌</span> Pinterest
          </h3>
          <span className="text-2xs bg-blue-500/15 text-blue-300 border border-blue-500/25 rounded-full px-2.5 py-0.5 font-medium">דרוש אפליקציית Pinterest</span>
        </div>
        <p className="text-xs text-white/35 mb-4">
          שמור כאן את פרטי Pinterest API. יצירת פינים אוטומטית תופעל לאחר אישור אפליקציית ה-API שלך אצל Pinterest.
        </p>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Board ID</label>
            <input value={pinBoardId} onChange={(e) => setPinBoardId(e.target.value)} placeholder="1234567890" dir="ltr"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50" />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Access Token</label>
            <input value={pinToken} onChange={(e) => setPinToken(e.target.value)} type="password" placeholder="pina_..." dir="ltr"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50" />
          </div>
        </div>
      </section>

      {/* Facebook / Meta — live */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <span className="text-lg">📘</span> Facebook Pages
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5 flex items-center gap-1.5">
              Page ID
              {facebookOk !== null && (
                facebookOk
                  ? <CheckCircle2 size={12} className="text-emerald-400" />
                  : <XCircle size={12} className="text-red-400" />
              )}
            </label>
            <input
              value={fbPageId}
              onChange={(e) => setFbPageId(e.target.value)}
              placeholder="123456789012345"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Page Access Token</label>
            <div className="relative">
              <input
                type={showFbToken ? 'text' : 'password'}
                value={fbToken}
                onChange={(e) => setFbToken(e.target.value)}
                placeholder="השאר ריק לשמור על הנוכחי"
                className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 pr-10 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
                dir="ltr"
              />
              <button type="button" onClick={() => setShowFbToken((s) => !s)}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-white/30 hover:text-white/60">
                {showFbToken ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            <p className="text-2xs text-white/25 mt-1">טוקן דף קבוע מ-Meta Graph API · ממולא רק בעת עדכון</p>
          </div>
          {facebookError && (
            <p className="text-2xs text-red-400 -mt-2">⚠️ חיבור הדף: {facebookError}</p>
          )}
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5 flex items-center gap-1.5">
              Meta Ad Account ID <span className="text-white/25">(ל-Boost)</span>
              {adAccountOk !== null && (
                adAccountOk
                  ? <CheckCircle2 size={12} className="text-emerald-400" />
                  : <XCircle size={12} className="text-red-400" />
              )}
            </label>
            <input
              value={metaAdAccount}
              onChange={(e) => setMetaAdAccount(e.target.value)}
              placeholder="act_1234567890"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
              dir="ltr"
            />
            {adAccountError && (
              <p className="text-2xs text-red-400 mt-1">⚠️ חשבון פרסום: {adAccountError}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saved ? 'נשמר ✓' : saving ? 'שומר...' : 'שמור'}
          </button>
          <button onClick={handleVerify} disabled={verifying}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-60 text-white/60 text-sm rounded-xl transition-all">
            {verifying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            בדוק דף + חשבון פרסום
          </button>
        </div>
      </section>

      {/* Make.com relay — publish Facebook through the user's own Make scenario */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <span className="text-lg">🔗</span> פרסום דרך Make (Webhook)
        </h3>
        <p className="text-2xs text-white/30 mb-4">
          מפרסם לפייסבוק דרך תרחיש ה-Make שלך (החיבור המורשה של Make) — עוקף את הצורך ב-Page Token. כשמופעל, פוסטים לפייסבוק נשלחים ל-Webhook במקום ל-Graph API הישיר. טלגרם ממשיך לצאת ישירות מהמערכת.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">כתובת Webhook של Make</label>
            <input value={makeUrl} onChange={(e) => setMakeUrl(e.target.value)} placeholder="https://hook.eu2.make.com/..." dir="ltr"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50" />
          </div>
          <button
            type="button"
            onClick={() => setPubViaMake((v) => !v)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all
              ${pubViaMake ? 'bg-blue-600/10 border-blue-500/30' : 'bg-white/3 border-edge-hover'}`}
          >
            <span className="flex items-center gap-2 text-sm text-white/80"><span>🔗</span>פרסם פייסבוק דרך Make</span>
            <span className={`relative w-9 h-5 rounded-full transition-colors ${pubViaMake ? 'bg-blue-500' : 'bg-white/15'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${pubViaMake ? 'right-0.5' : 'right-4'}`} />
            </span>
          </button>
        </div>
      </section>

      {/* Publish fan-out toggles */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <span className="text-lg">📡</span> ערוצי פרסום ברירת מחדל
        </h3>
        <p className="text-2xs text-white/30 mb-4">לאן פוסטים שנשלחים אוטומטית (הטייס האוטומטי, תור) יתפרסמו.</p>
        <div className="space-y-2">
          {[
            { label: 'Telegram', emoji: '📨', value: pubTelegram, set: setPubTelegram },
            { label: 'Facebook', emoji: '📘', value: pubFacebook, set: setPubFacebook },
            { label: 'Instagram', emoji: '📸', value: pubInstagram, set: setPubInstagram },
          ].map((ch) => (
            <button
              key={ch.label}
              type="button"
              onClick={() => ch.set(!ch.value)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all
                ${ch.value ? 'bg-blue-600/10 border-blue-500/30' : 'bg-white/3 border-edge-hover'}`}
            >
              <span className="flex items-center gap-2 text-sm text-white/80"><span>{ch.emoji}</span>{ch.label}</span>
              <span className={`relative w-9 h-5 rounded-full transition-colors ${ch.value ? 'bg-blue-500' : 'bg-white/15'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${ch.value ? 'right-0.5' : 'right-4'}`} />
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Auto image enhancement */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <span className="text-lg">✨</span> שיפור תמונות אוטומטי
        </h3>
        <p className="text-2xs text-white/30 mb-4">
          לפני פרסום בטלגרם, תמונות המוצר עוברות שיפור אוטומטי — חידוד, הבהרה, חיזוק צבעים ואיזון ניגודיות — לתמונה מקצועית ומזמינה יותר.
        </p>
        <button
          type="button"
          onClick={() => setImageEnhance((v) => !v)}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all
            ${imageEnhance ? 'bg-blue-600/10 border-blue-500/30' : 'bg-white/3 border-edge-hover'}`}
        >
          <span className="flex items-center gap-2 text-sm text-white/80"><span>✨</span>הפעל שיפור תמונות</span>
          <span className={`relative w-9 h-5 rounded-full transition-colors ${imageEnhance ? 'bg-blue-500' : 'bg-white/15'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${imageEnhance ? 'right-0.5' : 'right-4'}`} />
          </span>
        </button>
      </section>

      {/* Instagram Business (publishing reuses the Facebook Page token) */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
          <span className="text-lg">📸</span> Instagram Business
          {instagramOk === true && <CheckCircle2 size={14} className="text-emerald-400" />}
          {instagramOk === false && <XCircle size={14} className="text-red-400" />}
        </h3>
        <p className="text-xs text-white/35 mb-4">
          פרסום תמונות מוצר לחשבון Instagram Business. משתמש ב-Page Access Token של פייסבוק (למעלה) — ודא שהחשבון מקושר לדף ושלטוקן יש ההרשאה <span dir="ltr">instagram_content_publish</span>.
        </p>
        <div>
          <label className="block text-xs font-medium text-white/50 mb-1.5">Instagram Business Account ID</label>
          <input
            value={igBusinessId}
            onChange={(e) => setIgBusinessId(e.target.value)}
            placeholder="17841400000000000" dir="ltr"
            className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
          />
          <p className="text-2xs text-white/30 mt-1.5">
            מזהה חשבון האינסטגרם העסקי המקושר לדף (נמצא ב-Meta Business Suite ← הגדרות ← חשבונות Instagram).
          </p>
          {instagramError && <p className="text-2xs text-red-400 mt-2">⚠️ {instagramError}</p>}
        </div>
      </section>

      {/* Additional Channels */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="text-lg">📋</span> ערוצים נוספים
          </h3>
          <a href="/groups"
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors">
            <Plus size={12} />
            נהל ערוצים
          </a>
        </div>
        {loadingChannels ? (
          <div className="py-4 flex justify-center"><Loader2 size={18} className="animate-spin text-blue-400" /></div>
        ) : channels.length === 0 ? (
          <p className="text-xs text-white/30 text-center py-4">אין ערוצים נוספים — <a href="/groups" className="text-blue-400 hover:underline">הוסף ערוץ</a></p>
        ) : (
          <div className="space-y-2">
            {channels.map((c) => (
              <div key={c.id} className="flex items-center gap-3 py-2 px-3 bg-white/3 rounded-lg">
                <span className="text-base">📨</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{c.name}</p>
                  <p className="text-xs text-white/30">{c.channel_id || 'ללא Channel ID'}</p>
                </div>
                <div className={`text-xs px-2 py-0.5 rounded-full ${c.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-white/30'}`}>
                  {c.is_active ? 'פעיל' : 'מושבת'}
                </div>
                <button onClick={() => handleDeleteChannel(c.id)}
                  className="p-1 text-white/20 hover:text-red-400 transition-colors">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
