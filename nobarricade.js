/*!
 * NoBarricade v2.2.0
 * Ad blocker detection & page gating library for website developers
 * https://github.com/hexadecinull/nobarricade
 * MIT License
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

  const VERSION = '2.2.0';

  const DEFAULTS = {
    /*
     * How often (ms) to re-check while the gate is NOT showing.
     * Once the gate IS showing, the interval stops — the gate is only
     * lifted via the verify button. This eliminates all flicker.
     * Set 0 to check once on load only.
     */
    checkInterval: 8000,

    /*
     * Milliseconds to let the bait element settle in the DOM before
     * measuring it. Increase on very slow connections.
     */
    detectionTimeout: 1200,

    /*
     * Number of detection methods that must agree "blocked" before gating.
     * 1 = gate on first positive (recommended — the methods below are reliable).
     * 2 = require two methods to agree (reduces false positives on unusual networks).
     */
    sensitivity: 1,

    /*
     * Which detection methods to run.
     * 'bait'     — DOM element with ad class names, measure if hidden
     * 'fetch'    — HEAD request to a canonical ad URL, check for network error
     * 'script'   — inject an ad script tag, check onerror
     * 'css'      — CSS animation bait; fires if ad blocker suppresses it
     */
    methods: ['bait', 'fetch', 'script', 'css'],

    overlay: {
      title: 'Ad Blocker Detected',
      message: 'This website relies on advertising to keep running. Please disable your ad blocker to continue reading.',
      buttonText: "I've Disabled My Ad Blocker — Continue",
      buttonVerifyText: 'Verifying…',
      steps: [
        'Click the ad blocker icon in your browser toolbar.',
        'Select "Disable" or "Pause" for this site.',
        'Click the button below or reload the page.',
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

  /*
   * Fetch probe targets — ONLY stable, version-independent URLs that every
   * major ad blocker blocks, and which are reliably reachable without one.
   * Version-specific paths (e.g. publishertag.prebid.117.js) are excluded
   * because they 404 on the server side and produce false positives.
   */
  const FETCH_URLS = [
    'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
    'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
    'https://c.amazon-adsystem.com/aax2/apstag.js',
    'https://widgets.outbrain.com/outbrain.js',
    'https://cdn.taboola.com/libtrc/loader.js',
    'https://cdn.adnxs.com/ast/ast.js',
  ];

  /*
   * A known-good CDN URL that no ad blocker blocks.
   * Used as a network sanity check — if this fails too, the user is offline
   * or behind a captive portal, and we should not gate the page.
   */
  const SANITY_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js';

  /*
   * Script probe target — the single most universally blocked ad URL.
   * No cache-busting params: ad servers reject unknown query strings
   * and fire onerror even without an ad blocker, causing false positives.
   */
  const SCRIPT_URL = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

  const BAIT_CLASSES = [
    'pub_300x250', 'pub_300x250m', 'pub_728x90', 'pub_160x600',
    'text-ad', 'textAd', 'text_ad', 'text_ads', 'text-ads',
    'adsbox', 'adsbygoogle', 'adBanner', 'advert', 'ad-unit', 'ad-slot',
    'ad-banner', 'ad-container', 'ad-wrapper', 'advertisement',
    'banner_ad', 'adContainer', 'adInner', 'banner-ads',
    'ad-728x90', 'ad-160x600', 'ad-leaderboard', 'ad-box',
    'sponsored-content', 'promoted-content', 'native-ad', 'dfp-ad',
  ].join(' ');

  const _uid   = Math.random().toString(36).slice(2, 10);
  const OV_ID  = '__nb_ov_'  + _uid;
  const ST_ID  = '__nb_st_'  + _uid;
  const AN_ID  = 'nb_an_'    + _uid;

  let cfg = {};
  let st = {
    ready:       false,
    gated:       false,
    busy:        false,
    checks:      0,
    ticker:      null,
    watchTicker: null,
    observer:    null,
  };
  let _verifyAttempts = 0;
  let _keyFn = null;
  let _ctxFn = null;

  function log(...a) { if (cfg.debug) console.log('[NoBarricade]', ...a); }

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

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /* ─── CSS ───────────────────────────────────────────────────── */

  function buildCSS() {
    const a = cfg.overlay.accentColor;
    return `
#${OV_ID}{position:fixed!important;inset:0!important;width:100%!important;
height:100%!important;z-index:2147483647!important;display:flex!important;
align-items:center!important;justify-content:center!important;
visibility:visible!important;opacity:1!important;pointer-events:all!important;
background:rgba(7,10,22,.97)!important;
backdrop-filter:blur(6px)!important;-webkit-backdrop-filter:blur(6px)!important;
font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif!important;
box-sizing:border-box!important;padding:16px!important;
overflow-y:auto!important;margin:0!important;}
#${OV_ID} *{box-sizing:border-box!important;}
#${OV_ID} .nb-card{background:#fff!important;border-radius:16px!important;
padding:52px 44px!important;max-width:500px!important;width:100%!important;
text-align:center!important;box-shadow:0 40px 100px rgba(0,0,0,.55)!important;
position:relative!important;}
@media(max-width:540px){#${OV_ID} .nb-card{padding:36px 20px!important;border-radius:12px!important;}}
#${OV_ID} .nb-logo{margin:0 auto 28px!important;display:block!important;}
#${OV_ID} .nb-badge{display:inline-flex!important;align-items:center!important;
gap:7px!important;padding:5px 13px!important;background:#fef3c7!important;
border:1px solid #fcd34d!important;border-radius:99px!important;
font-size:11px!important;font-weight:700!important;letter-spacing:.9px!important;
text-transform:uppercase!important;color:#92400e!important;margin-bottom:22px!important;}
#${OV_ID} .nb-dot{width:7px!important;height:7px!important;border-radius:50%!important;
background:#d97706!important;flex-shrink:0!important;
animation:nb_pulse 1.6s ease infinite!important;}
@keyframes nb_pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.65)}}
#${OV_ID} .nb-title{font-size:28px!important;font-weight:800!important;
color:#0a0f1e!important;margin:0 0 14px!important;line-height:1.15!important;
letter-spacing:-.6px!important;}
#${OV_ID} .nb-msg{font-size:15px!important;color:#4b5563!important;
line-height:1.7!important;margin:0 0 30px!important;}
#${OV_ID} .nb-steps{text-align:left!important;background:#f9fafb!important;
border:1px solid #e5e7eb!important;border-radius:10px!important;
padding:22px!important;margin:0 0 28px!important;list-style:none!important;}
#${OV_ID} .nb-steps li{display:flex!important;align-items:flex-start!important;
gap:12px!important;font-size:14px!important;color:#374151!important;
line-height:1.55!important;padding:0!important;margin:0!important;}
#${OV_ID} .nb-steps li+li{margin-top:13px!important;padding-top:13px!important;
border-top:1px solid #e5e7eb!important;}
#${OV_ID} .nb-num{flex-shrink:0!important;width:24px!important;height:24px!important;
border-radius:50%!important;background:${a}!important;color:#fff!important;
font-size:11px!important;font-weight:700!important;display:flex!important;
align-items:center!important;justify-content:center!important;}
#${OV_ID} .nb-btn{display:block!important;width:100%!important;
padding:16px 24px!important;border-radius:10px!important;background:${a}!important;
color:#fff!important;font-size:15px!important;font-weight:700!important;
border:none!important;cursor:pointer!important;appearance:none!important;
outline:none!important;transition:opacity .15s!important;margin:0!important;}
#${OV_ID} .nb-btn:hover{opacity:.87!important;}
#${OV_ID} .nb-btn:disabled{opacity:.55!important;cursor:default!important;}
#${OV_ID} .nb-err{font-size:13px!important;color:#dc2626!important;
margin-top:12px!important;display:none!important;line-height:1.5!important;}
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
    return `<svg width="60" height="60" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg" class="nb-logo">
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
      <div class="nb-logo">${ov.logo
        ? `<img src="${ov.logo}" alt="${ov.brand}" style="height:60px;width:auto;">`
        : logoSVG()}</div>
      <div class="nb-badge"><span class="nb-dot"></span>Ad Blocker Detected</div>
      <h2 class="nb-title">${ov.title}</h2>
      <p class="nb-msg">${ov.message}</p>
      ${steps}
      <button class="nb-btn" id="${OV_ID}_btn">${ov.buttonText}</button>
      <p class="nb-err" id="${OV_ID}_err"></p>
      <div class="nb-hr"></div>
      <p class="nb-foot">Protected by <a href="https://hexadecinull.github.io/nobarricade" target="_blank" rel="noopener">${ov.brand}</a></p>
    </div>`;
    return el;
  }

  const FORCE_STYLE =
    'position:fixed!important;inset:0!important;width:100%!important;' +
    'height:100%!important;z-index:2147483647!important;display:flex!important;' +
    'visibility:visible!important;opacity:1!important;pointer-events:all!important;';

  /* ─── Gate ───────────────────────────────────────────────────── */

  function injectStyle() {
    let el = document.getElementById(ST_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = document.createElement('style');
    el.id = ST_ID;
    el.textContent = buildCSS();
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

    /*
     * CRITICAL: Stop the periodic interval once the gate is showing.
     * The gate is now exclusively user-controlled via the verify button.
     * Without this, the interval keeps re-running detection, gets an
     * inconsistent result on any given tick, and auto-hides the gate —
     * then the next tick detects again and shows it. That is the flicker.
     */
    if (st.ticker) { clearInterval(st.ticker); st.ticker = null; }
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

    /*
     * Restart the background interval now that the gate is gone,
     * so that if the user re-enables their ad blocker mid-session
     * we can catch it again.
     */
    if (cfg.checkInterval > 0 && !st.ticker) {
      st.ticker = setInterval(runCheck, cfg.checkInterval);
    }
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
          if (id === OV_ID || id === ST_ID) { dirty = true; }
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
      if (
        window.outerWidth  - window.innerWidth  > 160 ||
        window.outerHeight - window.innerHeight > 160
      ) repair();
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
          (cs && !e.shiftKey && 'uUsSpP'.includes(e.key))
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

  function onVerifyClick() {
    const btn = document.getElementById(OV_ID + '_btn');
    const err = document.getElementById(OV_ID + '_err');
    if (btn) { btn.disabled = true; btn.textContent = cfg.overlay.buttonVerifyText; }
    if (err) { err.textContent = ''; err.classList.remove('on'); }

    detect(function (found) {
      if (!found) {
        hideGate();
        if (typeof cfg.onCleared === 'function') try { cfg.onCleared(); } catch (_) {}
      } else {
        _verifyAttempts++;
        if (btn) { btn.disabled = false; btn.textContent = cfg.overlay.buttonText; }
        if (err) {
          err.textContent = _verifyAttempts >= 2
            ? 'Ad blocker still detected. Some blockers require a full page reload after being disabled — please refresh and try again.'
            : 'Ad blocker still detected. Please fully disable it for this site, then try again.';
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

  /* ─── Detection methods ──────────────────────────────────────── */

  /*
   * Bait element: inject a div with ad class names inside a zero-size
   * hidden wrapper (NOT position:fixed — fixed elements always have
   * offsetParent === null in every browser, causing false positives).
   * Ad blockers hide or collapse the inner element; we measure it.
   */
  function detectBait(cb) {
    const wrap = document.createElement('div');
    wrap.setAttribute('style',
      'position:absolute;top:0;left:0;width:0;height:0;' +
      'overflow:hidden;visibility:hidden;pointer-events:none;');

    const el = document.createElement('div');
    el.className = BAIT_CLASSES;
    el.setAttribute('style', 'width:300px;height:250px;display:block;');

    wrap.appendChild(el);
    (document.body || document.documentElement).appendChild(wrap);

    setTimeout(function () {
      let found = false;
      try {
        const cs = window.getComputedStyle(el);
        found =
          el.offsetHeight === 0 ||
          el.offsetWidth  === 0 ||
          cs.display      === 'none' ||
          cs.visibility   === 'hidden' ||
          cs.opacity      === '0' ||
          parseFloat(cs.maxHeight || '1') === 0 ||
          parseFloat(cs.maxWidth  || '1') === 0;
      } catch (_) {}
      try { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } catch (_) {}
      log('bait:', found);
      cb(found);
    }, cfg.detectionTimeout);
  }

  /*
   * Fetch probe: HEAD request to a canonical ad URL (no cache-busting params —
   * ad servers validate their own query strings and reject unknowns, causing
   * onerror without any ad blocker active).
   *
   * Before concluding "blocked", we run a sanity check against a neutral CDN
   * to rule out the user simply being offline or behind a captive portal.
   */
  function detectFetch(cb) {
    if (typeof fetch === 'undefined') { cb(false); return; }

    const adUrl  = pick(FETCH_URLS);
    const opts   = { method: 'HEAD', mode: 'no-cors', cache: 'no-store' };
    let   exited = false;

    function done(v) { if (!exited) { exited = true; log('fetch:', v); cb(v); } }

    const timer = setTimeout(function () { done(true); }, 6000);

    fetch(adUrl, opts)
      .then(function () { clearTimeout(timer); done(false); })
      .catch(function () {
        clearTimeout(timer);
        /*
         * Ad request failed — but verify it's not just the network being down.
         * Fetch the sanity URL; if that also fails, the user is offline and we
         * should not gate them.
         */
        const sanityTimer = setTimeout(function () { done(true); }, 4000);
        fetch(SANITY_URL, opts)
          .then(function ()  { clearTimeout(sanityTimer); done(true); })
          .catch(function () { clearTimeout(sanityTimer); done(false); });
      });
  }

  /*
   * Script probe: inject a <script> pointing to the canonical ad URL.
   * Ad blockers cancel the request and fire onerror.
   * NO cache-busting params — see detectFetch note above.
   */
  function detectScript(cb) {
    const id = '__nbsc_' + _uid;
    let   existing = document.getElementById(id);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    const sc  = document.createElement('script');
    sc.id     = id;
    sc.async  = true;
    sc.src    = SCRIPT_URL;
    let exited = false;

    function cleanup() {
      const s = document.getElementById(id);
      if (s && s.parentNode) s.parentNode.removeChild(s);
    }

    function done(v) {
      if (!exited) { exited = true; clearTimeout(timer); cleanup(); log('script:', v); cb(v); }
    }

    const timer = setTimeout(function () { done(true); }, 8000);
    sc.onload  = function () { done(false); };
    sc.onerror = function () { done(true);  };
    (document.head || document.documentElement).appendChild(sc);
  }

  /*
   * CSS animation bait: attach a no-op animation to an element with ad class
   * names. If the element is visible, animationstart fires immediately.
   * Ad blockers suppress it — we detect the absence of that event.
   * Same wrapper approach as detectBait (no fixed positioning).
   */
  function detectCSS(cb) {
    const styleEl = document.createElement('style');
    styleEl.textContent =
      '.nb_cb_' + _uid + '{animation:' + AN_ID + ' 0.001s!important;}' +
      '@keyframes ' + AN_ID + '{from{opacity:.99}to{opacity:1}}';

    const wrap = document.createElement('div');
    wrap.setAttribute('style',
      'position:absolute;top:0;left:0;width:0;height:0;' +
      'overflow:hidden;visibility:hidden;pointer-events:none;');

    const el = document.createElement('div');
    el.className = 'nb_cb_' + _uid + ' adsbygoogle pub_300x250 adsbox banner-ads ad-unit';
    el.setAttribute('style', 'width:300px;height:250px;display:block;');
    wrap.appendChild(el);

    let done = false;

    function cleanup() {
      if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      if (wrap.parentNode)    wrap.parentNode.removeChild(wrap);
    }

    const timer = setTimeout(function () {
      if (!done) { done = true; cleanup(); log('css: true (timeout)'); cb(true); }
    }, cfg.detectionTimeout + 500);

    el.addEventListener('animationstart', function () {
      if (!done) {
        done = true;
        clearTimeout(timer);
        cleanup();
        log('css: false (animation fired)');
        cb(false);
      }
    }, { once: true });

    (document.head || document.documentElement).appendChild(styleEl);
    (document.body || document.documentElement).appendChild(wrap);
  }

  /* ─── Orchestration ──────────────────────────────────────────── */

  function detect(cb) {
    const methods   = cfg.methods || DEFAULTS.methods;
    const threshold = Math.max(1, cfg.sensitivity || 1);
    const results   = [];
    let   pending   = 0;
    let   exited    = false;

    function tick(v) {
      if (exited) return;
      results.push(v);

      const hits      = results.filter(Boolean).length;
      const remaining = pending - results.length;

      if (hits >= threshold) {
        exited = true;
        log('detect → BLOCKED (' + hits + '+/' + pending + ')');
        return cb(true);
      }

      if (hits + remaining < threshold) {
        exited = true;
        log('detect → CLEAR (' + hits + '/' + pending + ')');
        return cb(false);
      }

      if (results.length === pending) {
        exited = true;
        log('detect → CLEAR final (' + hits + '/' + pending + ')');
        cb(false);
      }
    }

    if (methods.includes('bait'))               { pending++; detectBait(tick);   }
    if (methods.includes('fetch') &&
        typeof fetch !== 'undefined')            { pending++; detectFetch(tick);  }
    if (methods.includes('script'))              { pending++; detectScript(tick); }
    if (methods.includes('css'))                 { pending++; detectCSS(tick);   }

    if (pending === 0) cb(false);
  }

  /*
   * runCheck: only fires when the gate is NOT showing.
   * Once gated, the interval is stopped inside showGate().
   * This prevents the auto-show/auto-hide oscillation (flicker).
   */
  function runCheck() {
    if (st.busy || st.gated) return;
    st.busy = true;

    detect(function (found) {
      st.busy = false;
      st.checks++;

      if (found) {
        showGate();
        if (typeof cfg.onDetected === 'function') try { cfg.onDetected(); } catch (_) {}
      }
      /*
       * Deliberately no `else if (!found && st.gated) hideGate()` here.
       * Auto-hiding on a periodic check is what causes the flicker loop.
       * The gate is only ever lifted by the verify button (onVerifyClick).
       */
    });
  }

  /* ─── Public API ─────────────────────────────────────────────── */

  function init(userCfg) {
    if (st.ready) { log('Already initialized — call destroy() first'); return NoBarricade; }
    cfg = merge(DEFAULTS, userCfg || {});

    const go = function () {
      runCheck();
      if (cfg.checkInterval > 0) {
        st.ticker = setInterval(runCheck, cfg.checkInterval);
      }
      st.ready = true;
      log('v' + VERSION + ' initialized');
    };

    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', go, { once: true })
      : go();

    return NoBarricade;
  }

  function destroy() {
    if (st.ticker)      { clearInterval(st.ticker);      st.ticker      = null; }
    if (st.watchTicker) { clearInterval(st.watchTicker); st.watchTicker = null; }
    if (st.observer)    { st.observer.disconnect();       st.observer    = null; }
    hideGate();
    unlockInput();
    st.ready  = false;
    st.gated  = false;
    st.busy   = false;
    st.checks = 0;
    log('Destroyed');
    return NoBarricade;
  }

  const NoBarricade = {
    version:        VERSION,
    init,
    destroy,
    detect,
    isGated()       { return st.gated; },
    isInitialized() { return st.ready; },
    check()         { if (!st.gated) runCheck(); return this; },
    forceGate()     { if (!st.gated) showGate(); return this; },
    releaseGate()   { if (st.gated)  hideGate(); return this; },
  };

  return NoBarricade;
});
