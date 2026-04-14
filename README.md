# NoBarricade

**Ad blocker detection and page gating library for website developers.**

Detects ad blockers using six parallel methods across all major browsers and hard-gates your page content until the visitor disables theirs. One script tag, zero dependencies, no backend required.

[![License: LGPL-3.0](https://img.shields.io/badge/License-LGPL--3.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.1.0-blue.svg)]()
[![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-green.svg)]()
[![Size](https://img.shields.io/badge/size-~9KB-lightgrey.svg)]()

**[→ Documentation & Live Demo](https://hexadecinull.github.io/nobarricade)**

---

## What It Does

When a visitor loads your page with an ad blocker active, NoBarricade:

1. **Detects** the ad blocker using up to six independent methods simultaneously
2. **Early-exits** as soon as the sensitivity threshold is crossed — no waiting for slow methods
3. **Gates** the entire page with a tamper-resistant overlay
4. **Waits** until the visitor disables their ad blocker
5. **Re-verifies** the claim by running all methods again before releasing the gate
6. **Continues monitoring** on a configurable interval to catch mid-session activation

---

## Detection Methods

Six independent methods run in parallel. Any positive result (configurable via `sensitivity`) triggers the gate.

| Method | Key | How It Works | Catches |
|---|---|---|---|
| **Bait Element** | `bait` | Injects a div with 35+ ad-targeting class names. Ad blockers apply `display:none` via cosmetic filters — NoBarricade measures the zero dimensions. | uBlock Origin, AdGuard, Adblock Plus, Brave Shields |
| **Multi-Network Fetch** | `fetch` | Probes 4 random URLs from a pool of 30+ ad network endpoints. All four must succeed to clear. One failure per probe is tolerated for CDN flakiness — all must fail. | All blockers including Pi-hole, NextDNS, AdGuard Home |
| **Script Load** | `script` | Injects 2 script elements pointing to ad network JS files from different providers. `onerror` on either confirms blocking. | uBlock Origin, AdGuard, Adblock Plus, Brave Shields |
| **CSS Animation** | `css` | Applies a CSS animation to a bait element. `display:none` from cosmetic filters prevents `animationstart` from firing. Timeout = blocked. | Brave Shields, AdGuard cosmetic, uBlock Origin cosmetic |
| **Property Check** | `property` | Checks window globals from Google (`google_ad_status`, `googletag`), AppNexus (`apntag`), Taboola (`_taboola`), and Criteo (`criteo_q`). | Effective when those specific ad scripts are loaded on the page |
| **Brave API** | `brave` | Calls `navigator.brave.isBrave()` — a Promise exposed exclusively in Brave browser. Opt-in only, not in the default methods array. | Brave (100M+ users) with Shields enabled |

### Ad Blocker Coverage

| Ad Blocker | Type | Methods Used |
|---|---|---|
| uBlock Origin | Extension | `bait` `fetch` `script` `css` |
| Brave Shields | Browser built-in | `fetch` `script` `css` `brave` |
| AdGuard | Extension / App | `bait` `fetch` `script` `css` |
| Adblock Plus | Extension | `bait` `fetch` `script` |
| Pi-hole / AdGuard Home | DNS / Network | `fetch` `script` |
| NextDNS | DNS / Network | `fetch` `script` |
| Opera built-in | Browser built-in | `bait` `fetch` `script` `css` |
| Firefox ETP Strict | Browser built-in | `fetch` `script` |
| Samsung Internet (with blocker) | Browser + Extension | `bait` `fetch` `script` `css` |
| DuckDuckGo Browser | Browser built-in | `fetch` `script` |
| uBlock Origin Lite (Chrome MV3) | Extension (restricted) | `bait` `css` |

### Ad Network Probe Pool (30+)

The `fetch` and `script` methods sample from endpoints across all major ad networks:

Google (AdSense, DoubleClick, GPT), AppNexus/Xandr, Criteo, Taboola, Outbrain, Amazon Ads, Rubicon Project, PubMatic, Index Exchange, OpenX, Sovrn/Lijit, Media.net, ShareThrough, Moat, TripleLift, Tribal Fusion, Adtech, Undertone, Revcontent, AdForm, and more.

---

## Installation

### CDN (quickest)
```html
<script src="https://cdn.jsdelivr.net/gh/hexadecinull/nobarricade@latest/nobarricade.js"></script>
<script>
  NoBarricade.init();
</script>
```

### Self-hosted
Download `nobarricade.js` from this repository and serve it from your own domain.

### npm
```bash
npm install nobarricade
```
```js
import NoBarricade from 'nobarricade';
NoBarricade.init();
```

---

## Configuration

```js
NoBarricade.init({
  methods: ['bait', 'fetch', 'script', 'css', 'property'],
  sensitivity:       1,
  checkInterval:     3000,
  detectionTimeout:  850,

  overlay: {
    title:       'Ad Blocker Detected',
    message:     'This site relies on advertising to operate. Please disable your ad blocker to continue.',
    buttonText:  "I've Disabled My Ad Blocker — Continue",
    steps: [
      'Click the ad blocker icon in your browser toolbar.',
      'Select "Disable" or "Pause" for this site.',
      'Reload the page or click the button below.',
    ],
    showSteps:   true,
    accentColor: '#c8953a',
    brand:       'My Site',
    logo:        null,
  },

  protect: {
    rejectContextMenu:       true,
    rejectKeyboardShortcuts: true,
    lockScroll:              true,
    watchDevTools:           true,
    watchInterval:           750,
  },

  onDetected: function () {},
  onCleared:  function () {},
  debug:      false,
});
```

---

## API

All methods except `detect()` return `NoBarricade` for chaining.

```js
NoBarricade.init(config?)    // Initialize
NoBarricade.destroy()        // Stop everything, remove overlay
NoBarricade.detect(cb)       // Run detection once: cb(detected: boolean)
NoBarricade.check()          // Trigger one pass, update gate state
NoBarricade.isGated()        // → true if gate is currently showing
NoBarricade.isInitialized()  // → true after init(), before destroy()
NoBarricade.forceGate()      // Show the gate (testing)
NoBarricade.releaseGate()    // Hide the gate (testing)
```

---

## Browser Support

| Browser | Minimum Version |
|---|---|
| Chrome | 66+ |
| Firefox | 63+ |
| Safari | 12.1+ |
| Edge | 79+ |
| Opera | 53+ |
| Opera GX | 60+ |
| Brave | 1.0+ |
| Firefox for Android | 63+ |
| Chrome for Android | 66+ |
| Samsung Internet | 8+ |

---

## File Structure

```
nobarricade/
├── index.html      ← Documentation & landing page (GitHub Pages root)
├── demo.html       ← Interactive demo with live controls
├── nobarricade.js  ← Main library
├── README.md
└── LICENSE         ← LGPL-3.0
```

---

## GitHub Pages Setup

1. Create repo `hexadecinull/nobarricade`
2. Push all files to `main`
3. Settings → Pages → Source: `main` branch, `/ (root)`
4. Live at `hexadecinull.github.io/nobarricade`

---

## License

GNU Lesser General Public License v3.0 — see [LICENSE](LICENSE).

Built by [SSMG4](https://github.com/SSMG4) / [Hexadecinull](https://github.com/hexadecinull)
