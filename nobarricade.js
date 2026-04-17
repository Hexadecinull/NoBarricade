/*!
 * NoBarricade v2.1.0
 * Ad blocker detection & page gating library for website developers
 * https://github.com/hexadecinull/nobarricade
 * GNU Lesser General Public License v3.0 (LGPL-3.0)
 *
 * Detects ad blockers using multiple parallel methods and hard-gates page
 * content until the visitor disables their ad blocker.
 */
(function (global, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    global.NoBarricade = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const VERSION = '2.1.0';

  const DEFAULTS = {
    checkInterval: 3000,
    detectionTimeout: 1100,
    sensitivity: 2,
    methods: ['bait', 'fetch', 'script', 'css', 'property'],
    overlay: {
      title: 'Ad Blocker Detected',
      message: 'This website relies on advertising to keep running. Please disable your ad blocker to continue reading.',
      buttonText: 'I\'ve Disabled My Ad Blocker — Continue',
      buttonVerifyText: 'Verifying…',
      steps: [
        'Click the ad blocker icon in your browser toolbar.',
        'Select "Disable" or "Pause" for this site.',
        'Reload the page or click the button below.',
      ],
      brand: 'NoBarricade',
      logo: null,
      accentColor: '#c8953a',
      showSteps: true,
    },
    protect: {
      rejectContextMenu: true,
      rejectKeyboardShortcuts: true,
      lockScroll: true,
      watchDevTools: true,
      watchInterval: 750,
    },
    onDetected: null,
    onCleared: null,
    debug: false,
  };

  const _uid = Math.random().toString(36).slice(2, 10);
  const OV_ID = '__nb_ov_' + _uid;
  const ST_ID = '__nb_st_' + _uid;
  const BT_ID = '__nb_bt_' + _uid;
  const AN_ID = 'nb_an_' + _uid;

  const BAIT_CLASSES = [
    'pub_300x250', 'pub_300x250m', 'pub_728x90', 'pub_160x600', 'pub_970x250',
    'text-ad', 'textAd', 'text_ad', 'text_ads', 'text-ads', 'text-ad-links',
    'adsbox', 'adsbygoogle', 'adBanner', 'advert', 'ad-unit', 'ad-slot',
    'ad-banner', 'ad-container', 'ad-wrapper', 'advertisement', 'banner_ad',
    'ad_wrapper', 'adContainer', 'adInner', 'banner-ads', 'ad-300x250',
    'ad-728x90', 'ad-160x600', 'ad-970x90', 'ad-leaderboard', 'ad-box',
    'ad-label', 'ad-region', 'sponsored-content', 'sponsored_links',
    'promoted-content', 'native-ad', 'dfp-ad', 'gpt-ad',
  ].join(' ');

  const AD_FETCH_POOL = [
    'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
    'https://static.doubleclick.net/instream/ad_status.js',
    'https://adservice.google.com/adsid/google/ui',
    'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
    'https://cdn.adnxs.com/ast/ast.js',
    'https://secure.adnxs.com/seg?add=1&t=2',
    'https://static.criteo.net/js/ld/publishertag.prebid.117.js',
    'https://cas.criteo.com/delivery/lg.php',
    'https://cdn.taboola.com/libtrc/impl.269-1-RELEASE.js',
    'https://trc.taboola.com/trc/t/loader.js',
    'https://widgets.outbrain.com/outbrain.js',
    'https://c.amazon-adsystem.com/aax2/apstag.js',
    'https://mads.amazon-adsystem.com/ads/apms.js',
    'https://fastlane.rubiconproject.com/a/api/fastlane.js',
    'https://ads.pubmatic.com/AdServer/js/pwt/current/pwtag.min.js',
    'https://js-sec.indexww.com/ht/p/189053.js',
    'https://ap.lijit.com/www/delivery/fpi.js',
    'https://contextual.media.net/dmedianet.js',
    'https://native.sharethrough.com/assets/sfp.js',
    'https://cdn.moatads.com/nucleus-loader/v4/moatApiFrame.js',
    'https://s.tribalfusion.com/public/js/tribe.js',
    'https://adserver.adtech.de/pubs/js3.0/adtech.js',
    'https://www.googletagservices.com/tag/js/gpt.js',
    'https://cdn2.undertone.com/js/underscore-1.6.0.js',
    'https://p.revcontent.io/master.js',
    'https://files.adform.net/crossdomain.xml',
    'https://bidder.criteo.com/legacy/bids',
    'https://tlx.3lift.com/header/prebid',
    'https://exchange.postrelease.com/prebid',
    'https://display.basis.net/b/prebid',
  ];

  const AD_SCRIPT_POOL = [
    'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
    'https://cdn.adnxs.com/ast/ast.js',
    'https://cdn.taboola.com/libtrc/impl.269-1-RELEASE.js',
    'https://c.amazon-adsystem.com/aax2/apstag.js',
    'https://static.criteo.net/js/ld/publishertag.prebid.117.js',
    'https://widgets.outbrain.com/outbrain.js',
    'https://fastlane.rubiconproject.com/a/api/fastlane.js',
    'https://native.sharethrough.com/assets/sfp.js',
    'https://www.googletagservices.com/tag/js/gpt.js',
  ];

  let cfg = {};
  let st = {
    ready: false,
    gated: false,
    busy: false,
    checks: 0,
    ticker: null,
    watchTicker: null,
    observer: null,
  };
  let _keyFn = null;
  let _ctxFn = null;

  function log(...a) {
    if (cfg.debug) console.log('[NoBarricade]', ...a);
  }

  function merge(base, over) {
    const out = Object.assign({}, base);
    for (const k in over) {
      if (over[k] !== null && typeof over[k] === 'object' && !Array.isArray(over[k])) {
        out[k] = merge(base[k] || {}, over[k]);
      } else if (over[k] !== undefined) {
        out[k] = over[k];
      }
    }
    return out;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function css() {
    const a = cfg.overlay.accentColor;
    return `
#${OV_ID}{position:fixed!important;inset:0!important;width:100%!important;height:100%!important;
z-index:2147483647!important;display:flex!important;align-items:center!important;
justify-content:center!important;visibility:visible!important;opacity:1!important;
pointer-events:all!important;background:rgba(7,10,22,.97)!important;
backdrop-filter:blur(6px)!important;-webkit-backdrop-filter:blur(6px)!important;
font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif!important;
box-sizing:border-box!important;padding:16px!important;overflow-y:auto!important;margin:0!important;}
#${OV_ID} *{box-sizing:border-box!important;}
#${OV_ID} .nb-card{background:#fff!important;border-radius:16px!important;
padding:52px 44px!important;max-width:500px!important;width:100%!important;
text-align:center!important;box-shadow:0 40px 100px rgba(0,0,0,.55)!important;position:relative!important;}
@media(max-width:540px){#${OV_ID} .nb-card{padding:36px 20px!important;border-radius:12px!important;}}
#${OV_ID} .nb-logo-wrap{margin:0 auto 28px!important;display:block!important;}
#${OV_ID} .nb-badge{display:inline-flex!important;align-items:center!important;gap:7px!important;
padding:5px 13px!important;background:#fef3c7!important;border:1px solid #fcd34d!important;
border-radius:99px!important;font-size:11px!important;font-weight:700!important;
letter-spacing:.9px!important;text-transform:uppercase!important;color:#92400e!important;margin-bottom:22px!important;}
#${OV_ID} .nb-dot{width:7px!important;height:7px!important;border-radius:50%!important;
background:#d97706!important;flex-shrink:0!important;animation:nb_pulse 1.6s ease infinite!important;}
@keyframes nb_pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.65)}}
#${OV_ID} .nb-title{font-size:28px!important;font-weight:800!important;color:#0a0f1e!important;
margin:0 0 14px!important;line-height:1.15!important;letter-spacing:-.6px!important;}
#${OV_ID} .nb-msg{font-size:15px!important;color:#4b5563!important;line-height:1.7!important;margin:0 0 30px!important;}
#${OV_ID} .nb-steps{text-align:left!important;background:#f9fafb!important;border:1px solid #e5e7eb!important;
border-radius:10px!important;padding:22px!important;margin:0 0 28px!important;list-style:none!important;}
#${OV_ID} .nb-steps li{display:flex!important;align-items:flex-start!important;gap:12px!important;
font-size:14px!important;color:#374151!important;line-height:1.55!important;padding:0!important;margin:0!important;}
#${OV_ID} .nb-steps li+li{margin-top:13px!important;padding-top:13px!important;border-top:1px solid #e5e7eb!important;}
#${OV_ID} .nb-num{flex-shrink:0!important;width:24px!important;height:24px!important;border-radius:50%!important;
background:${a}!important;color:#fff!important;font-size:11px!important;font-weight:700!important;
display:flex!important;align-items:center!important;justify-content:center!important;}
#${OV_ID} .nb-btn{display:block!important;width:100%!important;padding:16px 24px!important;border-radius:10px!important;
background:${a}!important;color:#fff!important;font-size:15px!important;font-weight:700!important;
border:none!important;cursor:pointer!important;appearance:none!important;outline:none!important;
transition:opacity .15s!important;margin:0!important;}
#${OV_ID} .nb-btn:hover{opacity:.87!important;}
#${OV_ID} .nb-btn:disabled{opacity:.55!important;cursor:default!important;}
#${OV_ID} .nb-err{font-size:13px!important;color:#dc2626!important;margin-top:12px!important;
display:none!important;line-height:1.5!important;}
#${OV_ID} .nb-err.on{display:block!important;}
#${OV_ID} .nb-hr{height:1px!important;background:#e5e7eb!important;margin:26px 0!important;}
#${OV_ID} .nb-foot{font-size:12px!important;color:#9ca3af!important;}
#${OV_ID} .nb-foot a{color:${a}!important;text-decoration:none!important;}
#${OV_ID} .nb-shake{animation:nb_shake .45s ease!important;}
@keyframes nb_shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-7px)}
40%{transform:translateX(7px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}
@keyframes ${AN_ID}{from{opacity:.99}to{opacity:1}}
`;
  }

  function logoSVG() {
    const a = cfg.overlay.accentColor;
    return `<svg width="60" height="60" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="60" height="60" rx="15" fill="#0a0f1e"/>
<path d="M30 11L13 19.4V30C13 39.5 20.7 48.3 30 51C39.3 48.3 47 39.5 47 30V19.4L30 11Z" fill="${a}" opacity=".18"/>
<path d="M30 13.5L15 21.2V30C15 38.8 22 47.1 30 49.5C38 47.1 45 38.8 45 30V21.2L30 13.5Z" stroke="${a}" stroke-width="1.6" fill="none"/>
<circle cx="30" cy="30" r="5.5" fill="${a}"/>
<circle cx="30" cy="30" r="10" stroke="${a}" stroke-width="1.2" fill="none" opacity=".35"/>
<line x1="22" y1="22" x2="38" y2="38" stroke="#e53e3e" stroke-width="2.2" stroke-linecap="round"/>
<line x1="38" y1="22" x2="22" y2="38" stroke="#e53e3e" stroke-width="2.2" stroke-linecap="round"/>
</svg>`;
  }

  function buildCard() {
    const ov = cfg.overlay;
    const steps = ov.showSteps && ov.steps && ov.steps.length
      ? `<ol class="nb-steps">${ov.steps.map((s, i) =>
          `<li><span class="nb-num">${i + 1}</span><span>${s}</span></li>`
        ).join('')}</ol>`
      : '';

    const el = document.createElement('div');
    el.id = OV_ID;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="nb-card">
      <div class="nb-logo-wrap">${ov.logo
        ? `<img src="${ov.logo}" alt="${ov.brand}" style="height:60px;width:auto;">`
        : logoSVG()}</div>
      <div class="nb-badge"><span class="nb-dot"></span>Ad Blocker Detected</div>
      <h2 class="nb-title">${ov.title}</h2>
      <p class="nb-msg">${ov.message}</p>
      ${steps}
      <button class="nb-btn" id="${OV_ID}_btn">${ov.buttonText}</button>
      <p class="nb-err" id="${OV_ID}_err">Ad blocker still detected. Please fully disable it for this page.</p>
      <div class="nb-hr"></div>
      <p class="nb-foot">Protected by <a href="https://hexadecinull.github.io/nobarricade" target="_blank" rel="noopener">${ov.brand}</a></p>
    </div>`;
    return el;
  }

  const FORCE_STYLE = 'position:fixed!important;inset:0!important;width:100%!important;' +
    'height:100%!important;z-index:2147483647!important;display:flex!important;' +
    'visibility:visible!important;opacity:1!important;pointer-events:all!important;';

  function injectStyle() {
    let el = document.getElementById(ST_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = document.createElement('style');
    el.id = ST_ID;
    el.textContent = css();
    (document.head || document.documentElement).appendChild(el);
  }

  function applyForceStyle(el) {
    if (!el) return;
    el.setAttribute('style', FORCE_STYLE);
    el.style.cssText = FORCE_STYLE;
    el.removeAttribute('hidden');
    el.removeAttribute('aria-hidden');
  }

  function showGate() {
    injectStyle();
    let ov = document.getElementById(OV_ID);
    if (!ov) {
      ov = buildCard();
      document.documentElement.appendChild(ov);
    }
    applyForceStyle(ov);

    const btn = document.getElementById(OV_ID + '_btn');
    if (btn) btn.onclick = onVerifyClick;

    if (cfg.protect.lockScroll) {
      try {
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
      } catch (_) {}
    }

    st.gated = true;
    watchDOM();
    lockInput();
    if (cfg.protect.watchDevTools) startWatchDevTools();
  }

  function hideGate() {
    const ov = document.getElementById(OV_ID);
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    const se = document.getElementById(ST_ID);
    if (se && se.parentNode) se.parentNode.removeChild(se);

    if (cfg.protect.lockScroll) {
      try {
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
      } catch (_) {}
    }

    st.gated = false;
    _verifyAttempts = 0;
    unlockInput();
    if (st.watchTicker) { clearInterval(st.watchTicker); st.watchTicker = null; }
  }

  function repair() {
    if (!st.gated) return;
    if (!document.getElementById(ST_ID)) injectStyle();
    let ov = document.getElementById(OV_ID);
    if (!ov) {
      ov = buildCard();
      document.documentElement.appendChild(ov);
      const btn = document.getElementById(OV_ID + '_btn');
      if (btn) btn.onclick = onVerifyClick;
    }
    applyForceStyle(document.getElementById(OV_ID));
    if (cfg.protect.lockScroll) {
      try {
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
      } catch (_) {}
    }
  }

  function watchDOM() {
    if (st.observer) { st.observer.disconnect(); st.observer = null; }
    st.observer = new MutationObserver(function (muts) {
      if (!st.gated) return;
      let dirty = false;
      for (const m of muts) {
        if (m.type === 'childList') {
          for (const n of m.removedNodes) {
            if (n.id === OV_ID || n.id === ST_ID) { dirty = true; break; }
          }
        }
        if (m.type === 'attributes') {
          const id = m.target.id;
          if (id === OV_ID || id === ST_ID) { dirty = true; break; }
        }
        if (dirty) break;
      }
      if (dirty) setTimeout(repair, 0);
    });
    st.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'],
    });
  }

  function startWatchDevTools() {
    if (st.watchTicker) clearInterval(st.watchTicker);
    st.watchTicker = setInterval(function () {
      if (!st.gated) return;
      if (window.outerWidth - window.innerWidth > 160 || window.outerHeight - window.innerHeight > 160) {
        repair();
      }
    }, cfg.protect.watchInterval || 750);
  }

  function lockInput() {
    if (cfg.protect.rejectKeyboardShortcuts) {
      _keyFn = function (e) {
        if (!st.gated) return;
        const cs = e.ctrlKey || e.metaKey;
        if (
          e.key === 'F12' ||
          (cs && e.shiftKey && 'IJCKMijckm'.includes(e.key)) ||
          (cs && !e.shiftKey && 'uUsSpPaA'.includes(e.key))
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      };
      document.addEventListener('keydown', _keyFn, true);
    }
    if (cfg.protect.rejectContextMenu) {
      _ctxFn = function (e) {
        if (st.gated) { e.preventDefault(); e.stopImmediatePropagation(); }
      };
      document.addEventListener('contextmenu', _ctxFn, true);
    }
  }

  function unlockInput() {
    if (_keyFn) { document.removeEventListener('keydown', _keyFn, true); _keyFn = null; }
    if (_ctxFn) { document.removeEventListener('contextmenu', _ctxFn, true); _ctxFn = null; }
  }

  let _verifyAttempts = 0;

  function onVerifyClick() {
    const btn = document.getElementById(OV_ID + '_btn');
    const err = document.getElementById(OV_ID + '_err');
    if (btn) { btn.disabled = true; btn.textContent = cfg.overlay.buttonVerifyText; }
    if (err) err.classList.remove('on');

    detect(function (found) {
      if (!found) {
        _verifyAttempts = 0;
        hideGate();
        if (typeof cfg.onCleared === 'function') try { cfg.onCleared(); } catch (_) {}
      } else {
        _verifyAttempts++;
        if (btn) { btn.disabled = false; btn.textContent = cfg.overlay.buttonText; }
        if (err) {
          err.textContent = _verifyAttempts >= 2
            ? 'Ad blocker still detected. Some ad blockers require a full page reload — please refresh and try again.'
            : 'Ad blocker still detected. Please fully disable it for this page, then try again.';
          err.classList.add('on');
        }
        const card = document.querySelector('#' + OV_ID + ' .nb-card');
        if (card) {
          card.classList.remove('nb-shake');
          void card.offsetWidth;
          card.classList.add('nb-shake');
        }
      }
    });
  }

  function detectBait(cb) {
    const wrap = document.createElement('div');
    wrap.setAttribute('style',
      'position:absolute;top:0;left:0;width:0;height:0;overflow:hidden;' +
      'visibility:hidden;pointer-events:none;');

    const el = document.createElement('div');
    el.id = BT_ID;
    el.className = BAIT_CLASSES;
    el.setAttribute('style', 'width:300px;height:250px;display:block;');

    wrap.appendChild(el);
    (document.body || document.documentElement).appendChild(wrap);

    setTimeout(function () {
      let found = false;
      try {
        const cs = window.getComputedStyle(el);
        const h = el.offsetHeight;
        const w = el.offsetWidth;
        found =
          h === 0 ||
          w === 0 ||
          cs.display === 'none' ||
          cs.visibility === 'hidden' ||
          cs.opacity === '0' ||
          parseFloat(cs.maxHeight || '1') === 0 ||
          parseFloat(cs.maxWidth || '1') === 0;
      } catch (_) {}
      try { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } catch (_) {}
      cb(found);
    }, cfg.detectionTimeout);
  }

  function detectFetch(cb) {
    if (typeof fetch === 'undefined') { cb(false); return; }

    const urls = shuffle(AD_FETCH_POOL).slice(0, 4);
    let failed = 0;
    let exited = false;
    const timers = [];

    function onSuccess() {
      if (exited) return;
      exited = true;
      timers.forEach(clearTimeout);
      cb(false);
    }

    function onFail() {
      if (exited) return;
      failed++;
      if (failed === urls.length) { exited = true; timers.forEach(clearTimeout); cb(true); }
    }

    urls.forEach(function (url) {
      const t = setTimeout(function () { onFail(); }, 5500);
      timers.push(t);
      fetch(url + '?_nb=' + Date.now(), { method: 'HEAD', mode: 'no-cors', cache: 'no-store' })
        .then(function () { clearTimeout(t); onSuccess(); })
        .catch(function () { clearTimeout(t); onFail(); });
    });
  }

  function detectScript(cb) {
    const urls = shuffle(AD_SCRIPT_POOL).slice(0, 2);
    let failed = 0;
    let exited = false;
    const timers = [];

    function onSuccess() {
      if (exited) return;
      exited = true;
      timers.forEach(clearTimeout);
      cb(false);
    }

    function onFail() {
      if (exited) return;
      failed++;
      if (failed === urls.length) { exited = true; timers.forEach(clearTimeout); cb(true); }
    }

    urls.forEach(function (url) {
      const id = '__nbsc_' + Math.random().toString(36).slice(2, 8);
      const sc = document.createElement('script');
      sc.id = id;
      sc.async = true;
      sc.src = url + '?_nb=' + Date.now();

      function cleanup() {
        const s = document.getElementById(id);
        if (s && s.parentNode) s.parentNode.removeChild(s);
      }

      const t = setTimeout(function () { cleanup(); onFail(); }, 7000);
      timers.push(t);
      sc.onload = function () { clearTimeout(t); cleanup(); onSuccess(); };
      sc.onerror = function () { clearTimeout(t); cleanup(); onFail(); };
      (document.head || document.documentElement).appendChild(sc);
    });
  }

  function detectCSS(cb) {
    const styleEl = document.createElement('style');
    styleEl.textContent =
      '.nb-css-bait-' + _uid + '{animation:' + AN_ID + ' 0.001s!important;}';

    const wrap = document.createElement('div');
    wrap.setAttribute('style',
      'position:absolute;top:0;left:0;width:0;height:0;overflow:hidden;visibility:hidden;');

    const baitEl = document.createElement('div');
    baitEl.className = [
      'nb-css-bait-' + _uid,
      'ad-unit', 'adsbygoogle', 'pub_300x250', 'adsbox', 'banner-ads',
    ].join(' ');
    baitEl.setAttribute('style', 'width:300px;height:250px;display:block;');

    wrap.appendChild(baitEl);
    let done = false;

    function cleanup() {
      if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }

    const timer = setTimeout(function () {
      if (!done) { done = true; cleanup(); cb(true); }
    }, cfg.detectionTimeout + 400);

    baitEl.addEventListener('animationstart', function () {
      if (!done) { done = true; clearTimeout(timer); cleanup(); cb(false); }
    }, { once: true });

    (document.head || document.documentElement).appendChild(styleEl);
    (document.body || document.documentElement).appendChild(wrap);
  }

  function detectProperty(cb) {
    const found =
      (typeof window.google_ad_status !== 'undefined' && window.google_ad_status !== 'done') ||
      (typeof window.googletag !== 'undefined' &&
        typeof window.googletag.pubadsReady !== 'undefined' &&
        !window.googletag.pubadsReady) ||
      (typeof window._taboola !== 'undefined' && !Array.isArray(window._taboola)) ||
      (typeof window.apntag !== 'undefined' && typeof window.apntag.requests === 'undefined') ||
      (typeof window.criteo_q !== 'undefined' && typeof window.criteo_q.push !== 'function');
    cb(found);
  }

  function detectBrave(cb) {
    if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
      navigator.brave.isBrave()
        .then(function (v) { cb(v); })
        .catch(function () { cb(false); });
    } else {
      cb(false);
    }
  }

  function detect(cb) {
    const methods = cfg.methods || DEFAULTS.methods;
    const threshold = cfg.sensitivity || 1;
    const results = [];
    let pending = 0;
    let exited = false;

    function tick(v) {
      if (exited) return;
      results.push(v);
      const hits = results.filter(Boolean).length;
      const remaining = pending - results.length;

      if (hits >= threshold) {
        exited = true;
        log('Detected (' + hits + '/' + pending + ' hit):', results);
        return cb(true);
      }

      if (hits + remaining < threshold) {
        exited = true;
        log('Cleared (' + hits + '/' + pending + ' hit):', results);
        return cb(false);
      }

      if (results.length === pending) {
        exited = true;
        log('Final (' + hits + '/' + pending + '):', results);
        cb(false);
      }
    }

    if (methods.includes('bait'))     { pending++; detectBait(tick); }
    if (methods.includes('fetch'))    { pending++; detectFetch(tick); }
    if (methods.includes('script'))   { pending++; detectScript(tick); }
    if (methods.includes('css'))      { pending++; detectCSS(tick); }
    if (methods.includes('property')) { pending++; detectProperty(tick); }
    if (methods.includes('brave'))    { pending++; detectBrave(tick); }

    if (pending === 0) cb(false);
  }

  function runCheck() {
    if (st.busy) return;
    st.busy = true;
    detect(function (found) {
      st.busy = false;
      st.checks++;
      if (found && !st.gated) {
        log('Ad blocker detected — gating');
        showGate();
        if (typeof cfg.onDetected === 'function') try { cfg.onDetected(); } catch (_) {}
      } else if (!found && st.gated) {
        log('Cleared — releasing gate');
        hideGate();
        if (typeof cfg.onCleared === 'function') try { cfg.onCleared(); } catch (_) {}
      }
    });
  }

  function init(userCfg) {
    if (st.ready) { log('Already initialized'); return NoBarricade; }
    cfg = merge(DEFAULTS, userCfg || {});
    const go = function () {
      runCheck();
      if (cfg.checkInterval > 0) st.ticker = setInterval(runCheck, cfg.checkInterval);
      st.ready = true;
      log('v' + VERSION + ' initialized');
    };
    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', go, { once: true })
      : go();
    return NoBarricade;
  }

  function destroy() {
    if (st.ticker) { clearInterval(st.ticker); st.ticker = null; }
    if (st.watchTicker) { clearInterval(st.watchTicker); st.watchTicker = null; }
    if (st.observer) { st.observer.disconnect(); st.observer = null; }
    hideGate();
    unlockInput();
    st.ready = false;
    st.gated = false;
    st.busy = false;
    st.checks = 0;
    log('Destroyed');
    return NoBarricade;
  }

  const NoBarricade = {
    version: VERSION,
    init,
    destroy,
    detect,
    isGated()       { return st.gated; },
    isInitialized() { return st.ready; },
    check()         { runCheck(); return this; },
    forceGate()     { if (!st.gated) showGate(); return this; },
    releaseGate()   { if (st.gated) hideGate(); return this; },
  };

  return NoBarricade;
});
