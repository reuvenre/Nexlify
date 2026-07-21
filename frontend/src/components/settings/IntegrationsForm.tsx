'use client';

import { useState, useEffect } from 'react';
import { Eye, EyeOff, CheckCircle2, XCircle, Loader2, Save, Plus, Trash2 } from 'lucide-react';
import { credentialsApi, channelsApi, amazonApi } from '@/lib/api-client';
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
  const [pubTelegram, setPubTelegram] = useState(true);
  const [pubFacebook, setPubFacebook] = useState(false);
  const [facebookOk, setFacebookOk] = useState<boolean | null>(null);
  const [facebookError, setFacebookError] = useState<string | null>(null);

  // Instagram (reuses the Facebook Page token)
  const [igBusinessId, setIgBusinessId] = useState('');
  const [pubInstagram, setPubInstagram] = useState(false);
  const [instagramOk, setInstagramOk] = useState<boolean | null>(null);
  const [instagramError, setInstagramError] = useState<string | null>(null);
  const [testingIg, setTestingIg] = useState(false);

  // Auto image enhancement (local sharp pass, applied on the Telegram album)
  const [imageEnhance, setImageEnhance] = useState(false);

  // Facebook throttle: min minutes between FB posts per page (0 = every post). Paces FB
  // independently of Telegram so high-frequency posting doesn't hit Facebook's spam block.
  const [fbMinInterval, setFbMinInterval] = useState('0');

  // Make.com webhook relay (delivers Facebook via the user's own Make scenario)
  const [makeUrl, setMakeUrl] = useState('');
  const [pubViaMake, setPubViaMake] = useState(false);

  // Scaffolded integrations (credentials stored; activation pending external accounts)
  const [waPhoneId, setWaPhoneId] = useState('');
  const [waToken, setWaToken] = useState('');
  const [waProvider, setWaProvider] = useState('green');
  const [greenUrl, setGreenUrl] = useState('');
  const [greenInstance, setGreenInstance] = useState('');
  const [greenToken, setGreenToken] = useState('');
  const [waGroupId, setWaGroupId] = useState('');
  const [pubWhatsapp, setPubWhatsapp] = useState(false);
  const [whatsappOk, setWhatsappOk] = useState<boolean | null>(null);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  const [testingWa, setTestingWa] = useState(false);
  const [pinBoardId, setPinBoardId] = useState('');
  const [pinToken, setPinToken] = useState('');
  const [pubPinterest, setPubPinterest] = useState(false);
  const [pinterestOk, setPinterestOk] = useState<boolean | null>(null);
  const [pinterestError, setPinterestError] = useState<string | null>(null);
  const [testingPin, setTestingPin] = useState(false);
  const [amzAccess, setAmzAccess] = useState('');
  const [amzSecret, setAmzSecret] = useState('');
  const [amzPartner, setAmzPartner] = useState('');
  const [amazonOk, setAmazonOk] = useState<boolean | null>(null);
  const [amazonError, setAmazonError] = useState<string | null>(null);
  const [testingAmz, setTestingAmz] = useState(false);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);

  useEffect(() => {
    credentialsApi.get()
      .then((c) => {
        setDefaultChannel(c.telegram_channel_id || '');
        setFbPageId(c.facebook_page_id || '');
        setIgBusinessId(c.instagram_business_id || '');
        setPubTelegram(c.publish_telegram ?? true);
        setPubFacebook(c.publish_facebook ?? false);
        setPubInstagram(c.publish_instagram ?? false);
        setImageEnhance(c.image_enhance_enabled ?? false);
        setFbMinInterval(String(c.facebook_min_interval_minutes ?? 0));
        setMakeUrl(c.make_webhook_url || '');
        setPubViaMake(c.publish_via_make ?? false);
        setWaPhoneId(c.whatsapp_phone_number_id || '');
        setWaProvider(c.whatsapp_provider || 'green');
        setGreenUrl(c.green_api_url || '');
        setGreenInstance(c.green_api_instance_id || '');
        setWaGroupId(c.whatsapp_group_id || '');
        setPubWhatsapp(c.publish_whatsapp ?? false);
        setPinBoardId(c.pinterest_board_id || '');
        setPubPinterest(c.publish_pinterest ?? false);
        setAmzAccess(c.amazon_access_key || '');
        setAmzPartner(c.amazon_partner_tag || '');
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
        instagram_business_id: igBusinessId,
        publish_telegram: pubTelegram,
        publish_facebook: pubFacebook,
        publish_instagram: pubInstagram,
        image_enhance_enabled: imageEnhance,
        facebook_min_interval_minutes: Math.max(0, parseInt(fbMinInterval, 10) || 0),
        make_webhook_url: makeUrl,
        publish_via_make: pubViaMake,
        whatsapp_phone_number_id: waPhoneId,
        whatsapp_access_token: waToken,
        whatsapp_provider: waProvider,
        green_api_url: greenUrl,
        green_api_instance_id: greenInstance,
        green_api_token: greenToken,
        whatsapp_group_id: waGroupId,
        publish_whatsapp: pubWhatsapp,
        pinterest_board_id: pinBoardId,
        pinterest_access_token: pinToken,
        publish_pinterest: pubPinterest,
        amazon_access_key: amzAccess,
        amazon_secret_key: amzSecret,
        amazon_partner_tag: amzPartner,
      });
      setWaToken(''); setPinToken(''); setAmzSecret(''); setGreenToken('');
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
    } finally {
      setVerifying(false);
    }
  };

  const handleTestInstagram = async () => {
    setTestingIg(true);
    try {
      // Tests the SAVED credentials — persist a freshly-typed IG id / Page token first,
      // otherwise it checks the old saved state and confusingly reports "not entered".
      if (igBusinessId.trim() || fbToken.trim()) await handleSave();
      const res = await channelsApi.testInstagram();
      setInstagramOk(res.ok);
      setInstagramError(res.ok ? null : res.error || 'הבדיקה נכשלה.');
      // The test can auto-discover the correct IG id linked to the page — pre-fill it so the
      // user only has to press Save (the error text already tells them what happened).
      if (!res.ok && res.suggested_id) setIgBusinessId(res.suggested_id);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setInstagramOk(false);
      setInstagramError(err?.response?.data?.message || 'הבדיקה נכשלה.');
    } finally {
      setTestingIg(false);
    }
  };

  const handleTestPinterest = async () => {
    setTestingPin(true);
    try {
      // Persist a freshly-typed token / board first so the test checks the saved state.
      if (pinToken.trim() || pinBoardId.trim()) await handleSave();
      const res = await channelsApi.testPinterest();
      setPinterestOk(res.ok);
      setPinterestError(res.ok ? null : res.error || 'הבדיקה נכשלה.');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setPinterestOk(false);
      setPinterestError(err?.response?.data?.message || 'הבדיקה נכשלה.');
    } finally {
      setTestingPin(false);
    }
  };

  const handleTestAmazon = async () => {
    setTestingAmz(true);
    try {
      // Persist freshly-typed Amazon keys first so the live test checks the saved state.
      if (amzAccess.trim() || amzSecret.trim() || amzPartner.trim()) await handleSave();
      const res = await amazonApi.test();
      setAmazonOk(res.ok);
      setAmazonError(res.ok ? null : res.error || 'הבדיקה נכשלה.');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setAmazonOk(false);
      setAmazonError(err?.response?.data?.message || 'הבדיקה נכשלה.');
    } finally {
      setTestingAmz(false);
    }
  };

  const handleTestWhatsApp = async () => {
    setTestingWa(true);
    try {
      // Persist freshly-typed WhatsApp/Green settings first so the test checks the saved state.
      if (greenToken.trim() || greenInstance.trim() || waGroupId.trim() || waToken.trim()) await handleSave();
      const res = await channelsApi.testWhatsApp();
      setWhatsappOk(res.ok);
      setWhatsappError(res.ok ? null : res.error || 'הבדיקה נכשלה.');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setWhatsappOk(false);
      setWhatsappError(err?.response?.data?.message || 'הבדיקה נכשלה.');
    } finally {
      setTestingWa(false);
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

      {/* WhatsApp — Green API (posts to GROUPS) or the official Cloud API (direct messages). */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
          <span className="text-lg">💬</span> WhatsApp
          {whatsappOk === true && <CheckCircle2 size={14} className="text-emerald-400" />}
          {whatsappOk === false && <XCircle size={14} className="text-red-400" />}
        </h3>
        <p className="text-xs text-white/35 mb-4">
          פרסום מוצרים לוואטסאפ. <span className="text-white/60">Green API</span> יכול לפרסם ל<span className="text-white/60">קבוצה</span> (מומלץ); ה-API הרשמי של Meta שולח הודעות ישירות בלבד (לא לקבוצות).
        </p>

        {/* Provider toggle */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {([
            { key: 'green', label: 'Green API', desc: 'פרסום לקבוצה' },
            { key: 'official', label: 'Meta רשמי', desc: 'הודעה ישירה' },
          ] as const).map((opt) => (
            <button key={opt.key} type="button" onClick={() => setWaProvider(opt.key)}
              className={`p-2.5 rounded-lg border text-right transition-all ${waProvider === opt.key ? 'bg-blue-600/20 border-blue-500/50' : 'bg-white/5 border-edge hover:bg-white/10'}`}>
              <p className={`text-sm font-medium ${waProvider === opt.key ? 'text-blue-200' : 'text-white/70'}`}>{opt.label}</p>
              <p className="text-2xs text-white/35 mt-0.5">{opt.desc}</p>
            </button>
          ))}
        </div>

        {waProvider === 'green' ? (
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">ID Instance</label>
              <input value={greenInstance} onChange={(e) => setGreenInstance(e.target.value)} placeholder="1101000001" dir="ltr"
                className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">API Token Instance</label>
              <input value={greenToken} onChange={(e) => setGreenToken(e.target.value)} type="password" placeholder="••••••••" dir="ltr"
                className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">מזהה קבוצת יעד (Group ID)</label>
              <input value={waGroupId} onChange={(e) => setWaGroupId(e.target.value)} placeholder="120363XXXXXXXXXXXX@g.us" dir="ltr"
                className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50" />
              <p className="text-2xs text-white/30 mt-1.5">מזהה הקבוצה מקונסולת Green API (או השדה getChatId). ניתן להדביק עם או בלי הסיומת <span dir="ltr">@g.us</span>.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">API URL (אופציונלי)</label>
              <input value={greenUrl} onChange={(e) => setGreenUrl(e.target.value)} placeholder="https://api.green-api.com" dir="ltr"
                className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50" />
              <p className="text-2xs text-white/30 mt-1.5">ריק = ברירת המחדל. אם ה-instance שלך משתמש בכתובת אחרת (למשל <span dir="ltr">https://7105.api.greenapi.com</span>) — הדבק אותה כאן.</p>
            </div>
          </div>
        ) : (
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
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">מספר יעד (Recipient)</label>
              <input value={waGroupId} onChange={(e) => setWaGroupId(e.target.value)} placeholder="972500000000" dir="ltr"
                className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50" />
              <p className="text-2xs text-white/30 mt-1.5">ה-API הרשמי שולח למספר בודד (שפנה לעסק ב-24 השעות האחרונות / דרך תבנית מאושרת). אין תמיכה בקבוצות.</p>
            </div>
          </div>
        )}

        <label className="flex items-center gap-2.5 mt-4 cursor-pointer select-none">
          <input type="checkbox" checked={pubWhatsapp} onChange={(e) => setPubWhatsapp(e.target.checked)} className="w-4 h-4 rounded accent-blue-500" />
          <span className="text-sm text-white/80">פרסם כל פוסט גם לוואטסאפ</span>
        </label>

        {whatsappError && <p className="text-2xs text-red-400 mt-3">⚠️ {whatsappError}</p>}
        {whatsappOk === true && <p className="text-2xs text-emerald-400 mt-3">✅ החיבור תקין — מוכן לפרסום.</p>}

        <button type="button" onClick={handleTestWhatsApp} disabled={testingWa}
          className="mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-white/5 border border-edge-hover text-white/80 hover:bg-white/10 disabled:opacity-50 transition-colors">
          {testingWa ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
          בדוק תקינות וואטסאפ
        </button>
      </section>

      {/* Pinterest — live. Pins carry a real clickable affiliate link (unlike Instagram). */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
          <span className="text-lg">📌</span> Pinterest
          {pinterestOk === true && <CheckCircle2 size={14} className="text-emerald-400" />}
          {pinterestOk === false && <XCircle size={14} className="text-red-400" />}
        </h3>
        <p className="text-xs text-white/35 mb-4">
          פרסום פינים לחשבון Pinterest — הפין נושא <span className="text-white/60">לינק לחיץ</span> ישירות למוצר (יתרון על אינסטגרם). דרוש Access Token מ-Pinterest Developer עם ההרשאות <span dir="ltr">boards:read, pins:write</span> ומזהה לוח (Board).
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

        <label className="flex items-center gap-2.5 mt-4 cursor-pointer select-none">
          <input type="checkbox" checked={pubPinterest} onChange={(e) => setPubPinterest(e.target.checked)}
            className="w-4 h-4 rounded accent-blue-500" />
          <span className="text-sm text-white/80">פרסם כל פוסט גם לפינטרסט</span>
        </label>

        {pinterestError && <p className="text-2xs text-red-400 mt-3">⚠️ {pinterestError}</p>}
        {pinterestOk === true && <p className="text-2xs text-emerald-400 mt-3">✅ הלוח נגיש והטוקן תקין — מוכן לפרסום.</p>}

        <button
          type="button"
          onClick={handleTestPinterest}
          disabled={testingPin}
          className="mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-white/5 border border-edge-hover text-white/80 hover:bg-white/10 disabled:opacity-50 transition-colors"
        >
          {testingPin ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
          בדוק תקינות פינטרסט
        </button>
      </section>

      {/* Amazon (PA-API) — product SOURCE: the autopilot can search Amazon by keyword. */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
          <span className="text-lg">🛒</span> Amazon
          {amazonOk === true && <CheckCircle2 size={14} className="text-emerald-400" />}
          {amazonOk === false && <XCircle size={14} className="text-red-400" />}
        </h3>
        <p className="text-xs text-white/35 mb-4">
          מקור מוצרים נוסף לטייס האוטומטי — חיפוש מוצרי אמזון לפי מילות מפתח (Product Advertising API). דרוש חשבון <span dir="ltr">Amazon Associates</span> מאושר עם גישת PA-API. צור טייס אוטומטי עם מקור &quot;Amazon&quot;.
        </p>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Access Key</label>
            <input value={amzAccess} onChange={(e) => setAmzAccess(e.target.value)} placeholder="AKIA..." dir="ltr"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50" />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Secret Key</label>
            <input value={amzSecret} onChange={(e) => setAmzSecret(e.target.value)} type="password" placeholder="••••••••" dir="ltr"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50" />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Partner Tag (Associate Tag)</label>
            <input value={amzPartner} onChange={(e) => setAmzPartner(e.target.value)} placeholder="mytag-20" dir="ltr"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50" />
          </div>
        </div>

        {amazonError && <p className="text-2xs text-red-400 mt-3">⚠️ {amazonError}</p>}
        {amazonOk === true && <p className="text-2xs text-emerald-400 mt-3">✅ החיבור ל-Amazon PA-API תקין — מוכן לחיפוש מוצרים.</p>}

        <button
          type="button"
          onClick={handleTestAmazon}
          disabled={testingAmz}
          className="mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-white/5 border border-edge-hover text-white/80 hover:bg-white/10 disabled:opacity-50 transition-colors"
        >
          {testingAmz ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
          בדוק תקינות אמזון
        </button>
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

        {/* Facebook throttle — pace FB independently of Telegram (FB blocks high-frequency posting). */}
        {pubFacebook && (
          <div className="mt-3 border-t border-edge pt-3">
            <label className="block text-xs font-medium text-white/60 mb-1.5">מרווח מינימלי בין פרסומים לפייסבוק (דקות)</label>
            <input
              type="number" min={0} step={30}
              value={fbMinInterval}
              onChange={(e) => setFbMinInterval(e.target.value)}
              placeholder="0"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
              dir="ltr"
            />
            <p className="text-2xs text-white/30 mt-1.5 leading-relaxed">
              פייסבוק חוסמת פרסום בתדירות גבוהה. כאן קובעים כל כמה זמן דף יקבל פוסט לכל היותר — <b>טלגרם ממשיך בקצב המלא</b>, רק פייסבוק מואט.
              <br />למשל <b>180</b> = פוסט אחד לפייסבוק כל 3 שעות לכל דף. <b>0</b> = כל פוסט (ללא האטה).
            </p>
          </div>
        )}
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
          {instagramOk === true && <p className="text-2xs text-emerald-400 mt-2">✅ החשבון תקין ומקושר — מוכן לפרסום.</p>}

          <button
            type="button"
            onClick={handleTestInstagram}
            disabled={testingIg}
            className="mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-white/5 border border-edge-hover text-white/80 hover:bg-white/10 disabled:opacity-50 transition-colors"
          >
            {testingIg ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            בדוק תקינות אינסטגרם
          </button>
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
