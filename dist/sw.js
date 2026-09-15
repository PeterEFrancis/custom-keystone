/* Bump this version whenever app code, styling, or a vendored runtime changes.
 * No skipWaiting: an update never replaces a worker used by an open pattern.
 * Closing the app's old windows lets the waiting version activate for next use.
 */
const CACHE_VERSION = '2026-09-14-pattern-projector-1';
const CACHE_PREFIX = `keystone-pattern-projector:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const APP_FILES = [
  "index.html",
  "style.css",
  "app.js",
  "geometry.js",
  "projector-math.js",
  "pattern-layout.js",
  "document-source.js",
  "export-pattern.js",
  "manifest.webmanifest",
  "icon.svg",
  "vendor/pdf-lib/pdf-lib.esm.min.js",
  "vendor/pdfjs/build/pdf.min.mjs",
  "vendor/pdfjs/build/pdf.worker.min.mjs",
  "vendor/pdfjs/cmaps/78-EUC-H.bcmap",
  "vendor/pdfjs/cmaps/78-EUC-V.bcmap",
  "vendor/pdfjs/cmaps/78-H.bcmap",
  "vendor/pdfjs/cmaps/78-RKSJ-H.bcmap",
  "vendor/pdfjs/cmaps/78-RKSJ-V.bcmap",
  "vendor/pdfjs/cmaps/78-V.bcmap",
  "vendor/pdfjs/cmaps/78ms-RKSJ-H.bcmap",
  "vendor/pdfjs/cmaps/78ms-RKSJ-V.bcmap",
  "vendor/pdfjs/cmaps/83pv-RKSJ-H.bcmap",
  "vendor/pdfjs/cmaps/90ms-RKSJ-H.bcmap",
  "vendor/pdfjs/cmaps/90ms-RKSJ-V.bcmap",
  "vendor/pdfjs/cmaps/90msp-RKSJ-H.bcmap",
  "vendor/pdfjs/cmaps/90msp-RKSJ-V.bcmap",
  "vendor/pdfjs/cmaps/90pv-RKSJ-H.bcmap",
  "vendor/pdfjs/cmaps/90pv-RKSJ-V.bcmap",
  "vendor/pdfjs/cmaps/Add-H.bcmap",
  "vendor/pdfjs/cmaps/Add-RKSJ-H.bcmap",
  "vendor/pdfjs/cmaps/Add-RKSJ-V.bcmap",
  "vendor/pdfjs/cmaps/Add-V.bcmap",
  "vendor/pdfjs/cmaps/Adobe-CNS1-0.bcmap",
  "vendor/pdfjs/cmaps/Adobe-CNS1-1.bcmap",
  "vendor/pdfjs/cmaps/Adobe-CNS1-2.bcmap",
  "vendor/pdfjs/cmaps/Adobe-CNS1-3.bcmap",
  "vendor/pdfjs/cmaps/Adobe-CNS1-4.bcmap",
  "vendor/pdfjs/cmaps/Adobe-CNS1-5.bcmap",
  "vendor/pdfjs/cmaps/Adobe-CNS1-6.bcmap",
  "vendor/pdfjs/cmaps/Adobe-CNS1-UCS2.bcmap",
  "vendor/pdfjs/cmaps/Adobe-GB1-0.bcmap",
  "vendor/pdfjs/cmaps/Adobe-GB1-1.bcmap",
  "vendor/pdfjs/cmaps/Adobe-GB1-2.bcmap",
  "vendor/pdfjs/cmaps/Adobe-GB1-3.bcmap",
  "vendor/pdfjs/cmaps/Adobe-GB1-4.bcmap",
  "vendor/pdfjs/cmaps/Adobe-GB1-5.bcmap",
  "vendor/pdfjs/cmaps/Adobe-GB1-UCS2.bcmap",
  "vendor/pdfjs/cmaps/Adobe-Japan1-0.bcmap",
  "vendor/pdfjs/cmaps/Adobe-Japan1-1.bcmap",
  "vendor/pdfjs/cmaps/Adobe-Japan1-2.bcmap",
  "vendor/pdfjs/cmaps/Adobe-Japan1-3.bcmap",
  "vendor/pdfjs/cmaps/Adobe-Japan1-4.bcmap",
  "vendor/pdfjs/cmaps/Adobe-Japan1-5.bcmap",
  "vendor/pdfjs/cmaps/Adobe-Japan1-6.bcmap",
  "vendor/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap",
  "vendor/pdfjs/cmaps/Adobe-Korea1-0.bcmap",
  "vendor/pdfjs/cmaps/Adobe-Korea1-1.bcmap",
  "vendor/pdfjs/cmaps/Adobe-Korea1-2.bcmap",
  "vendor/pdfjs/cmaps/Adobe-Korea1-UCS2.bcmap",
  "vendor/pdfjs/cmaps/B5-H.bcmap",
  "vendor/pdfjs/cmaps/B5-V.bcmap",
  "vendor/pdfjs/cmaps/B5pc-H.bcmap",
  "vendor/pdfjs/cmaps/B5pc-V.bcmap",
  "vendor/pdfjs/cmaps/CNS-EUC-H.bcmap",
  "vendor/pdfjs/cmaps/CNS-EUC-V.bcmap",
  "vendor/pdfjs/cmaps/CNS1-H.bcmap",
  "vendor/pdfjs/cmaps/CNS1-V.bcmap",
  "vendor/pdfjs/cmaps/CNS2-H.bcmap",
  "vendor/pdfjs/cmaps/CNS2-V.bcmap",
  "vendor/pdfjs/cmaps/ETHK-B5-H.bcmap",
  "vendor/pdfjs/cmaps/ETHK-B5-V.bcmap",
  "vendor/pdfjs/cmaps/ETen-B5-H.bcmap",
  "vendor/pdfjs/cmaps/ETen-B5-V.bcmap",
  "vendor/pdfjs/cmaps/ETenms-B5-H.bcmap",
  "vendor/pdfjs/cmaps/ETenms-B5-V.bcmap",
  "vendor/pdfjs/cmaps/EUC-H.bcmap",
  "vendor/pdfjs/cmaps/EUC-V.bcmap",
  "vendor/pdfjs/cmaps/Ext-H.bcmap",
  "vendor/pdfjs/cmaps/Ext-RKSJ-H.bcmap",
  "vendor/pdfjs/cmaps/Ext-RKSJ-V.bcmap",
  "vendor/pdfjs/cmaps/Ext-V.bcmap",
  "vendor/pdfjs/cmaps/GB-EUC-H.bcmap",
  "vendor/pdfjs/cmaps/GB-EUC-V.bcmap",
  "vendor/pdfjs/cmaps/GB-H.bcmap",
  "vendor/pdfjs/cmaps/GB-V.bcmap",
  "vendor/pdfjs/cmaps/GBK-EUC-H.bcmap",
  "vendor/pdfjs/cmaps/GBK-EUC-V.bcmap",
  "vendor/pdfjs/cmaps/GBK2K-H.bcmap",
  "vendor/pdfjs/cmaps/GBK2K-V.bcmap",
  "vendor/pdfjs/cmaps/GBKp-EUC-H.bcmap",
  "vendor/pdfjs/cmaps/GBKp-EUC-V.bcmap",
  "vendor/pdfjs/cmaps/GBT-EUC-H.bcmap",
  "vendor/pdfjs/cmaps/GBT-EUC-V.bcmap",
  "vendor/pdfjs/cmaps/GBT-H.bcmap",
  "vendor/pdfjs/cmaps/GBT-V.bcmap",
  "vendor/pdfjs/cmaps/GBTpc-EUC-H.bcmap",
  "vendor/pdfjs/cmaps/GBTpc-EUC-V.bcmap",
  "vendor/pdfjs/cmaps/GBpc-EUC-H.bcmap",
  "vendor/pdfjs/cmaps/GBpc-EUC-V.bcmap",
  "vendor/pdfjs/cmaps/H.bcmap",
  "vendor/pdfjs/cmaps/HKdla-B5-H.bcmap",
  "vendor/pdfjs/cmaps/HKdla-B5-V.bcmap",
  "vendor/pdfjs/cmaps/HKdlb-B5-H.bcmap",
  "vendor/pdfjs/cmaps/HKdlb-B5-V.bcmap",
  "vendor/pdfjs/cmaps/HKgccs-B5-H.bcmap",
  "vendor/pdfjs/cmaps/HKgccs-B5-V.bcmap",
  "vendor/pdfjs/cmaps/HKm314-B5-H.bcmap",
  "vendor/pdfjs/cmaps/HKm314-B5-V.bcmap",
  "vendor/pdfjs/cmaps/HKm471-B5-H.bcmap",
  "vendor/pdfjs/cmaps/HKm471-B5-V.bcmap",
  "vendor/pdfjs/cmaps/HKscs-B5-H.bcmap",
  "vendor/pdfjs/cmaps/HKscs-B5-V.bcmap",
  "vendor/pdfjs/cmaps/Hankaku.bcmap",
  "vendor/pdfjs/cmaps/Hiragana.bcmap",
  "vendor/pdfjs/cmaps/KSC-EUC-H.bcmap",
  "vendor/pdfjs/cmaps/KSC-EUC-V.bcmap",
  "vendor/pdfjs/cmaps/KSC-H.bcmap",
  "vendor/pdfjs/cmaps/KSC-Johab-H.bcmap",
  "vendor/pdfjs/cmaps/KSC-Johab-V.bcmap",
  "vendor/pdfjs/cmaps/KSC-V.bcmap",
  "vendor/pdfjs/cmaps/KSCms-UHC-H.bcmap",
  "vendor/pdfjs/cmaps/KSCms-UHC-HW-H.bcmap",
  "vendor/pdfjs/cmaps/KSCms-UHC-HW-V.bcmap",
  "vendor/pdfjs/cmaps/KSCms-UHC-V.bcmap",
  "vendor/pdfjs/cmaps/KSCpc-EUC-H.bcmap",
  "vendor/pdfjs/cmaps/KSCpc-EUC-V.bcmap",
  "vendor/pdfjs/cmaps/Katakana.bcmap",
  "vendor/pdfjs/cmaps/NWP-H.bcmap",
  "vendor/pdfjs/cmaps/NWP-V.bcmap",
  "vendor/pdfjs/cmaps/RKSJ-H.bcmap",
  "vendor/pdfjs/cmaps/RKSJ-V.bcmap",
  "vendor/pdfjs/cmaps/Roman.bcmap",
  "vendor/pdfjs/cmaps/UniCNS-UCS2-H.bcmap",
  "vendor/pdfjs/cmaps/UniCNS-UCS2-V.bcmap",
  "vendor/pdfjs/cmaps/UniCNS-UTF16-H.bcmap",
  "vendor/pdfjs/cmaps/UniCNS-UTF16-V.bcmap",
  "vendor/pdfjs/cmaps/UniCNS-UTF32-H.bcmap",
  "vendor/pdfjs/cmaps/UniCNS-UTF32-V.bcmap",
  "vendor/pdfjs/cmaps/UniCNS-UTF8-H.bcmap",
  "vendor/pdfjs/cmaps/UniCNS-UTF8-V.bcmap",
  "vendor/pdfjs/cmaps/UniGB-UCS2-H.bcmap",
  "vendor/pdfjs/cmaps/UniGB-UCS2-V.bcmap",
  "vendor/pdfjs/cmaps/UniGB-UTF16-H.bcmap",
  "vendor/pdfjs/cmaps/UniGB-UTF16-V.bcmap",
  "vendor/pdfjs/cmaps/UniGB-UTF32-H.bcmap",
  "vendor/pdfjs/cmaps/UniGB-UTF32-V.bcmap",
  "vendor/pdfjs/cmaps/UniGB-UTF8-H.bcmap",
  "vendor/pdfjs/cmaps/UniGB-UTF8-V.bcmap",
  "vendor/pdfjs/cmaps/UniJIS-UCS2-H.bcmap",
  "vendor/pdfjs/cmaps/UniJIS-UCS2-HW-H.bcmap",
  "vendor/pdfjs/cmaps/UniJIS-UCS2-HW-V.bcmap",
  "vendor/pdfjs/cmaps/UniJIS-UCS2-V.bcmap",
  "vendor/pdfjs/cmaps/UniJIS-UTF16-H.bcmap",
  "vendor/pdfjs/cmaps/UniJIS-UTF16-V.bcmap",
  "vendor/pdfjs/cmaps/UniJIS-UTF32-H.bcmap",
  "vendor/pdfjs/cmaps/UniJIS-UTF32-V.bcmap",
  "vendor/pdfjs/cmaps/UniJIS-UTF8-H.bcmap",
  "vendor/pdfjs/cmaps/UniJIS-UTF8-V.bcmap",
  "vendor/pdfjs/cmaps/UniJIS2004-UTF16-H.bcmap",
  "vendor/pdfjs/cmaps/UniJIS2004-UTF16-V.bcmap",
  "vendor/pdfjs/cmaps/UniJIS2004-UTF32-H.bcmap",
  "vendor/pdfjs/cmaps/UniJIS2004-UTF32-V.bcmap",
  "vendor/pdfjs/cmaps/UniJIS2004-UTF8-H.bcmap",
  "vendor/pdfjs/cmaps/UniJIS2004-UTF8-V.bcmap",
  "vendor/pdfjs/cmaps/UniJISPro-UCS2-HW-V.bcmap",
  "vendor/pdfjs/cmaps/UniJISPro-UCS2-V.bcmap",
  "vendor/pdfjs/cmaps/UniJISPro-UTF8-V.bcmap",
  "vendor/pdfjs/cmaps/UniJISX0213-UTF32-H.bcmap",
  "vendor/pdfjs/cmaps/UniJISX0213-UTF32-V.bcmap",
  "vendor/pdfjs/cmaps/UniJISX02132004-UTF32-H.bcmap",
  "vendor/pdfjs/cmaps/UniJISX02132004-UTF32-V.bcmap",
  "vendor/pdfjs/cmaps/UniKS-UCS2-H.bcmap",
  "vendor/pdfjs/cmaps/UniKS-UCS2-V.bcmap",
  "vendor/pdfjs/cmaps/UniKS-UTF16-H.bcmap",
  "vendor/pdfjs/cmaps/UniKS-UTF16-V.bcmap",
  "vendor/pdfjs/cmaps/UniKS-UTF32-H.bcmap",
  "vendor/pdfjs/cmaps/UniKS-UTF32-V.bcmap",
  "vendor/pdfjs/cmaps/UniKS-UTF8-H.bcmap",
  "vendor/pdfjs/cmaps/UniKS-UTF8-V.bcmap",
  "vendor/pdfjs/cmaps/V.bcmap",
  "vendor/pdfjs/cmaps/WP-Symbol.bcmap",
  "vendor/pdfjs/iccs/CGATS001Compat-v2-micro.icc",
  "vendor/pdfjs/standard_fonts/FoxitDingbats.pfb",
  "vendor/pdfjs/standard_fonts/FoxitFixed.pfb",
  "vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb",
  "vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb",
  "vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb",
  "vendor/pdfjs/standard_fonts/FoxitSerif.pfb",
  "vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb",
  "vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb",
  "vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb",
  "vendor/pdfjs/standard_fonts/FoxitSymbol.pfb",
  "vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf",
  "vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf",
  "vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf",
  "vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
  "vendor/pdfjs/wasm/jbig2.wasm",
  "vendor/pdfjs/wasm/jbig2_nowasm_fallback.js",
  "vendor/pdfjs/wasm/openjpeg.wasm",
  "vendor/pdfjs/wasm/openjpeg_nowasm_fallback.js",
  "vendor/pdfjs/wasm/qcms_bg.wasm",
  "vendor/pdfjs/wasm/quickjs-eval.js",
  "vendor/pdfjs/wasm/quickjs-eval.wasm"
];
const APP_URLS = APP_FILES.map(path => new URL(path, self.registration.scope).href);
const APP_URL_SET = new Set(APP_URLS);
const INDEX_URL = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const existed = await caches.has(CACHE_NAME);
    const cache = await caches.open(CACHE_NAME);
    let next = 0;
    // Include infrequently used CMaps/codecs now so a new PDF also works offline.
    // A failed asset prevents activation rather than claiming incomplete support.
    const worker = async () => {
      while (next < APP_URLS.length) {
        const url = APP_URLS[next++];
        const response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
        if (!response.ok || response.type === 'opaque') throw new Error(`Could not cache ${url}`);
        await cache.put(url, response);
      }
    };
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, worker));
    const failure = outcomes.find(outcome => outcome.status === 'rejected');
    if (failure) {
      if (!existed) await caches.delete(CACHE_NAME);
      throw failure.reason;
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    // This also enables offline dynamic PDF imports on the first visit.
    // Natural activation waits for previous controlled windows; it never reloads one.
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  const isAppNavigation = request.mode === 'navigate' &&
    (url.pathname === scope.pathname || url.pathname === new URL(INDEX_URL).pathname);
  url.search = '';
  url.hash = '';
  const key = isAppNavigation ? INDEX_URL : url.href;
  if (!isAppNavigation && !APP_URL_SET.has(key)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(key);
    if (cached) return cached;
    // Recover an evicted asset while online. Only listed app files are cached;
    // selected documents, blob URLs, and unrelated same-origin pages never are.
    const response = await fetch(request);
    if (response.ok && response.type !== 'opaque') {
      try { await cache.put(key, response.clone()); } catch { /* Storage can be evicted or full. */ }
    }
    return response;
  })());
});
