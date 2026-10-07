/**
 * A product Reel as a HyperFrames composition (HTML + GSAP → MP4), 1080×1920, 12 s.
 *
 *   0.0–3.2  the first photo, the headline              — the hook
 *   3.2–6.4  the second photo, one line of why          — the reason
 *   6.4–9.6  the third photo, the price and the saving  — the deal
 *   9.6–12   the call to action and the brand           — the ask
 *
 * Every text value is the backend's (spec.json), escaped here. Hebrew: dir="rtl" sits on the
 * root div and the text blocks, never on <html> (a known silent blank-render failure).
 * No sound: music has licensing of its own, and Reels autoplay muted anyway.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** A number inside Hebrew keeps its own order («2,300+» must not turn into «+2,300»). */
const num = (s) => `<bdi dir="ltr">${esc(s)}</bdi>`;

export const DURATION = 12;
const SCENES = [0, 3.2, 6.4, 9.6];

/** @param {{headline:string, reason?:string, price:string, was?:string, discount?:number, rating?:number, orders?:string, cta:string, brand?:string, images:string[]}} spec — images are local asset paths */
export function buildComposition(spec) {
  const imgs = spec.images.length ? spec.images : [''];
  const img = (i) => imgs[i % imgs.length];
  const scene = (i, inner) => {
    const start = SCENES[i];
    const dur = (SCENES[i + 1] ?? DURATION) - start;
    return `<div id="s${i}" class="clip scene" data-start="${start}" data-duration="${dur}" data-track-index="${i}">${inner}</div>`;
  };
  const photo = (i, n) => `
      <div class="bg" style="background-image:url('${esc(img(n))}')"></div>
      <div class="shade"></div>
      <div class="card${i === 0 ? '' : ' high'}" id="card${i}"><img src="${esc(img(n))}" alt=""></div>`;

  const stats = [
    spec.rating ? `★ ${num(spec.rating)}` : '',
    spec.orders ? `${num(spec.orders)} הזמנות` : '',
  ].filter(Boolean).join(' · ');

  return `<!doctype html>
<html lang="he" data-resolution="portrait">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@500;800;900&display=swap" rel="stylesheet" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1080px; height: 1920px; overflow: hidden; background: #0b0d10; }
      #root { position: relative; width: 100%; height: 100%; font-family: "Heebo", sans-serif; color: #fff; }
      .scene { position: absolute; inset: 0; overflow: hidden; background: #0b0d10; }
      .bg { position: absolute; inset: -60px; background-size: cover; background-position: center; filter: blur(38px) brightness(0.45); }
      .shade { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.55) 100%); }
      .card { position: absolute; left: 90px; top: 520px; width: 900px; height: 900px; border-radius: 44px; overflow: hidden; box-shadow: 0 40px 90px rgba(0,0,0,0.55); background: #fff; }
      .card.high { top: 250px; }
      .card img { width: 100%; height: 100%; object-fit: contain; background: #fff; }
      .top { position: absolute; left: 70px; right: 70px; top: 150px; display: flex; flex-direction: column; gap: 26px; align-items: flex-start; }
      .chip { font-size: 40px; font-weight: 800; background: #ffd400; color: #111; padding: 12px 30px; border-radius: 999px; }
      .headline { font-size: 84px; font-weight: 900; line-height: 1.08; max-width: 940px; text-shadow: 0 6px 24px rgba(0,0,0,0.5); }
      .reason { position: absolute; left: 70px; right: 70px; bottom: 210px; font-size: 64px; font-weight: 800; line-height: 1.15; text-shadow: 0 6px 24px rgba(0,0,0,0.6); }
      .deal { position: absolute; left: 70px; right: 70px; bottom: 170px; display: flex; flex-direction: column; gap: 18px; align-items: flex-start; }
      .price { font-size: 170px; font-weight: 900; color: #ffd400; line-height: 1; text-shadow: 0 8px 30px rgba(0,0,0,0.6); font-variant-numeric: tabular-nums; }
      .was { font-size: 60px; font-weight: 500; color: #e6e6e6; text-decoration: line-through; }
      .off { font-size: 54px; font-weight: 900; background: #ff3b3b; color: #fff; padding: 10px 28px; border-radius: 22px; }
      .stats { font-size: 46px; font-weight: 500; color: #f2f2f2; }
      .end { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 56px; text-align: center; }
      .end .thumb { width: 560px; height: 560px; border-radius: 40px; overflow: hidden; background: #fff; box-shadow: 0 30px 80px rgba(0,0,0,0.6); }
      .end .thumb img { width: 100%; height: 100%; object-fit: contain; }
      .cta { font-size: 96px; font-weight: 900; color: #ffd400; max-width: 940px; line-height: 1.1; }
      .brand { font-size: 52px; font-weight: 800; color: #fff; opacity: 0.9; }
    </style>
  </head>
  <body>
    <div id="root" dir="rtl" data-composition-id="main" data-start="0" data-duration="${DURATION}" data-width="1080" data-height="1920" data-fps="30">
      ${scene(0, `${photo(0, 0)}
        <div class="top" dir="rtl">${spec.brand ? `<div class="chip" id="chip0">${esc(spec.brand)}</div>` : ''}<div class="headline" id="h0">${esc(spec.headline)}</div></div>`)}
      ${scene(1, `${photo(1, 1)}
        <div class="reason" id="r1" dir="rtl">${esc(spec.reason || spec.headline)}</div>`)}
      ${scene(2, `${photo(2, 2)}
        <div class="deal" dir="rtl">
          ${spec.discount ? `<div class="off" id="off2">${num(`${spec.discount}%`)} הנחה</div>` : ''}
          <div class="price" id="p2">${num(spec.price)}</div>
          ${spec.was ? `<div class="was" id="w2">במקום ${num(spec.was)}</div>` : ''}
          ${stats ? `<div class="stats" id="st2">${stats}</div>` : ''}
        </div>`)}
      ${scene(3, `<div class="bg" style="background-image:url('${esc(img(0))}')"></div><div class="shade"></div>
        <div class="end" dir="rtl">
          <div class="thumb" id="t3"><img src="${esc(img(0))}" alt=""></div>
          <div class="cta" id="c3">${esc(spec.cta)}</div>
          ${spec.brand ? `<div class="brand" id="b3">${esc(spec.brand)}</div>` : ''}
        </div>`)}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      const S = ${JSON.stringify(SCENES)};
      const has = (sel) => !!document.querySelector(sel);
      // Scene transitions: each scene fades in over the one below; the photo card drifts.
      for (let i = 1; i < S.length; i++) tl.from("#s" + i, { opacity: 0, duration: 0.45, ease: "power2.out" }, S[i]);
      for (let i = 0; i < 3; i++) {
        tl.from("#card" + i, { scale: 0.86, y: 60, opacity: 0, duration: 0.7, ease: "back.out(1.4)" }, S[i] + 0.15);
        tl.to("#card" + i, { scale: 1.06, duration: (S[i + 1] - S[i]) - 0.9, ease: "none" }, S[i] + 0.85);
      }
      if (has("#chip0")) tl.from("#chip0", { x: 120, opacity: 0, duration: 0.5, ease: "power3.out" }, 0.2);
      tl.from("#h0", { y: 50, opacity: 0, duration: 0.65, ease: "expo.out" }, 0.35);
      tl.from("#r1", { y: 70, opacity: 0, duration: 0.6, ease: "power3.out" }, S[1] + 0.45);
      if (has("#off2")) tl.from("#off2", { scale: 0.4, opacity: 0, duration: 0.45, ease: "back.out(2.2)" }, S[2] + 0.35);
      tl.from("#p2", { y: 60, opacity: 0, duration: 0.55, ease: "expo.out" }, S[2] + 0.5);
      if (has("#w2")) tl.from("#w2", { x: 80, opacity: 0, duration: 0.5, ease: "power2.out" }, S[2] + 0.75);
      if (has("#st2")) tl.from("#st2", { y: 30, opacity: 0, duration: 0.5, ease: "sine.out" }, S[2] + 0.95);
      tl.from("#t3", { scale: 0.7, opacity: 0, duration: 0.6, ease: "back.out(1.6)" }, S[3] + 0.2);
      tl.from("#c3", { y: 50, opacity: 0, duration: 0.55, ease: "expo.out" }, S[3] + 0.45);
      if (has("#b3")) tl.from("#b3", { opacity: 0, duration: 0.5, ease: "sine.out" }, S[3] + 0.75);
      tl.to("#root", { opacity: 0, duration: 0.4, ease: "power1.in" }, ${DURATION} - 0.45);
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}
