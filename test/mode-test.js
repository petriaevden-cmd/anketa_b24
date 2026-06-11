// Verifies the index.php bootstrap added/extended on v5-latest:
//
//   A. OUTSIDE iframe (?leadId)        -> webhook-shim activates, lead loads via webhook.
//   B. INSIDE iframe on apcheit.ru with ?DOMAIN=crm.yurclick.com (NO leadId in URL,
//      lead comes from placement) -> BX24 SDK is injected from the crm.yurclick.com
//      portal (applayout.js), webhook is NOT used, no "BX24 SDK не загружен", and the
//      header log link (APP_CONFIG.logUrl) points at logs.txt next to index.php —
//      NOT at index.php?DOMAIN=...&APP_SID=...#.
//
// No PHP runtime here, so the test server emulates index.php's PHP header
// (DOMAIN whitelist -> portalUrl/appEnv, logUrl built from script path w/o query)
// and substitutes the <?= ?> echoes, then serves the resulting HTML. The real
// assets/*.js run unchanged.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const CHROME = '/home/user/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';

const LEAD_ID = 12826;
// FAKE webhook URL (no real secret); requests are stubbed anyway.
const FAKE_WEBHOOK = 'https://crm.yurclick.com/rest/0/TESTONLYFAKEKEY';

// Mirror of index.php's $DOMAIN_PORTAL_MAP. Keep in sync with index.php.
const DOMAIN_PORTAL_MAP = {
  'crm.yurclick.com': { url: 'https://crm.yurclick.com', env: 'prod' },
  'dev.yurclick.com': { url: 'https://dev.yurclick.com', env: 'dev' },
};
// Fallback when DOMAIN absent/unknown (stands in for config.php constants).
const CONFIG_FALLBACK = { portalUrl: 'https://dev.yurclick.com', appEnv: 'dev' };

const INDEX_SRC = fs.readFileSync(path.join(ROOT, 'index.php'), 'utf8');

// Render index.php for one request, emulating the PHP header logic.
// ctx: { query (object), httpHost, scriptName }
function renderIndex(ctx) {
  let s = INDEX_SRC.slice(INDEX_SRC.indexOf('<!DOCTYPE'));

  // --- emulate PHP: DOMAIN whitelist -> portalUrl / appEnv ---
  const reqDomain = (ctx.query.DOMAIN || '').toString().trim().toLowerCase();
  let portalUrl, appEnv;
  if (reqDomain && DOMAIN_PORTAL_MAP[reqDomain]) {
    portalUrl = DOMAIN_PORTAL_MAP[reqDomain].url;
    appEnv = DOMAIN_PORTAL_MAP[reqDomain].env;
  } else {
    portalUrl = CONFIG_FALLBACK.portalUrl;
    appEnv = CONFIG_FALLBACK.appEnv;
  }

  // --- emulate PHP: logUrl from script path WITHOUT query ---
  const scriptName = ctx.scriptName;            // e.g. /yurclick/anketa-kc/index.php
  const logDir = path.posix.dirname(scriptName).replace(/\/+$/, '');
  const logUrl = ctx.httpHost
    ? 'http://' + ctx.httpHost + logDir + '/logs.txt'
    : logDir + '/logs.txt';

  // Replace the whole APP_CONFIG <script> with one built from emulated values.
  const cfg = `<script>
    window.APP_CONFIG = {
      salesDeptId: 1, bpTemplateId: 40, appEnv: ${JSON.stringify(appEnv)},
      slotMin: 60, horizonDays: 7, minSlots: 1,
      clientHrMin: 9, clientHrMax: 20, minMpPerDay: 3,
      webhookUrl: ${JSON.stringify(FAKE_WEBHOOK)},
      currentUser: { ID: 0, NAME: "", LAST_NAME: "", EMAIL: "" },
      logUrl: ${JSON.stringify(logUrl)}
    };
  </script>`;
  s = s.replace(/<script>\s*\n\s*window\.APP_CONFIG[\s\S]*?<\/script>/, cfg);

  // Substitute the portalUrl echo used by the SDK-injection block.
  s = s.replace(/<\?=\s*json_encode\(\$portalUrl\)\s*\?>/g, JSON.stringify(portalUrl));
  // Any remaining PHP echoes -> empty string literal (none expected to matter here).
  s = s.replace(/<\?(php|=)[\s\S]*?\?>/g, '""');
  // Drop the Yandex metrika block (network noise in test).
  s = s.replace(/<script type="text\/javascript">\s*\(function\(m,e,t,r,i,k,a\)[\s\S]*?<\/noscript>/, '<!-- metrika removed -->');
  return s;
}

const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };

// Server that renders index.php per-request with a fixed HTTP_HOST/SCRIPT_NAME,
// emulating the app living at /yurclick/anketa-kc/ on apcheit.ru.
function serveApp(httpHost, scriptPrefix) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      let p = decodeURIComponent(u.pathname);
      // index.php (with or without the /yurclick/anketa-kc prefix)
      if (p === '/' || p.endsWith('/index.php')) {
        const query = {};
        for (const [k, v] of u.searchParams.entries()) query[k] = v;
        const html = renderIndex({ query, httpHost, scriptName: scriptPrefix + '/index.php' });
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html); return;
      }
      // Strip the script prefix to find assets on disk.
      let rel = p.startsWith(scriptPrefix + '/') ? p.slice(scriptPrefix.length) : p;
      const fp = path.join(ROOT, rel);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(0, () => resolve(srv));
  });
}

function serveHtml(html) {
  return new Promise((resolve) => {
    const srv = http.createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); });
    srv.listen(0, () => resolve(srv));
  });
}

function webhookData(method) {
  if (method === 'crm.lead.get') return { result: { ID: String(LEAD_ID), TITLE: 'Лид #' + LEAD_ID + ' (webhook)', CONTACT_ID: '0' } };
  if (method === 'crm.lead.list') return { result: [], total: 0 };
  return { result: [] };
}

const SDK_STUB = `(function(){window.BX24={init:function(cb){setTimeout(cb,0);},
  placement:{info:function(){return{placement:"CRM_LEAD_DETAIL_TAB",options:{ID:${LEAD_ID}}};}},
  callMethod:function(m,p,cb){var d={};if(m==="crm.lead.get")d={ID:"${LEAD_ID}",TITLE:"Лид (SDK)",CONTACT_ID:"0"};else if(m==="user.current")d={ID:"1",NAME:"Test"};else if(m==="user.get")d=[{ID:"1",NAME:"Test"}];else d=[];
  setTimeout(function(){cb&&cb({data:function(){return d;},error:function(){return false;},total:function(){return 0;},more:function(){return false;}});},0);return true;},
  callBatch:function(c,cb){var o={};Object.keys(c).forEach(function(k){var mm=c[k][0];var dd=(mm==="crm.lead.get")?{ID:"${LEAD_ID}",TITLE:"Лид (SDK)",CONTACT_ID:"0"}:(mm==="user.current"?{ID:"1",NAME:"Test"}:[]);o[k]={data:function(){return dd;},error:function(){return false;},total:function(){return 0;},more:function(){return false;}};});
  setTimeout(function(){cb&&cb(o);},0);return true;},
  callBind:function(){return true;},callUnbind:function(){return true;},installFinish:function(){},getAuth:function(){return {access_token:"x"};},fitWindow:function(){},resizeWindow:function(){}};})();`;

async function run() {
  const HOST = 'apcheit.ru';
  const PREFIX = '/yurclick/anketa-kc';
  const srv = await serveApp(HOST, PREFIX);
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}${PREFIX}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  const failures = [];

  // ── Scenario A: OUTSIDE iframe (?leadId) -> shim loads the lead ─────────────
  {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

    await page.route('**/rest/**', (route) => {
      const m = (route.request().url().match(/\/([a-z0-9_.]+)\.json/i) || [])[1] || '';
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(webhookData(m)) });
    });
    let sdkRequested = false;
    await page.route('**/bitrix/js/rest/applayout.js', (r) => { sdkRequested = true; r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }); });
    await page.route('**/api.bitrix24.com/**', (r) => { sdkRequested = true; r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }); });

    await page.goto(`${base}/index.php?leadId=${LEAD_ID}`, { waitUntil: 'networkidle' });

    const useWebhook = await page.evaluate(() => window.APP_USE_WEBHOOK);
    const bxIsShim = await page.evaluate(() => !!(window.BX24_WEBHOOK && window.BX24 === window.BX24_WEBHOOK));
    await page.waitForFunction(() => {
      const f = document.getElementById('anketa-form');
      return f && !f.classList.contains('hidden') && document.querySelector('#section-5-body input[type=radio]');
    }, { timeout: 8000 }).catch(() => {});
    const formShown = await page.evaluate(() => { const f = document.getElementById('anketa-form'); return !!(f && !f.classList.contains('hidden')); });
    const sdkError = errors.some(e => /BX24 SDK не загружен|BX24 is not defined|BX24.*undefined/.test(e));

    console.log('--- Scenario A: OUTSIDE iframe (?leadId) ---');
    console.log('APP_USE_WEBHOOK =', useWebhook, '(expect true)');
    console.log('BX24===shim     =', bxIsShim, '(expect true)');
    console.log('SDK requested   =', sdkRequested, '(expect false)');
    console.log('form shown      =', formShown, '(expect true)');
    console.log('SDK-error       =', sdkError, '(expect false)');
    if (errors.length) console.log('console errors:\n' + errors.join('\n'));

    if (useWebhook !== true) failures.push('A: APP_USE_WEBHOOK !== true');
    if (!bxIsShim) failures.push('A: BX24 is not the webhook shim');
    if (sdkRequested) failures.push('A: SDK requested outside iframe');
    if (!formShown) failures.push('A: form did not render via webhook');
    if (sdkError) failures.push('A: SDK-not-loaded error appeared');
    await page.close();
  }

  // ── Scenario B: INSIDE iframe on apcheit.ru, ?DOMAIN=crm.yurclick.com, no leadId
  {
    const childUrl = `${base}/index.php?DOMAIN=crm.yurclick.com&PROTOCOL=1&LANG=ru&APP_SID=1f04376527912c28d610b744c4ca10f9`;
    const parentHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
      <body><iframe id="f" src="${childUrl}" style="width:900px;height:700px;border:0"></iframe></body></html>`;
    const psrv = await serveHtml(parentHtml);
    const pport = psrv.address().port;

    const page = await browser.newPage({ viewport: { width: 950, height: 750 } });
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

    let sdkRequested = false, sdkFromCrm = false, webhookUsed = false;
    await page.route('**/rest/**', (r) => { webhookUsed = true; r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":[]}' }); });
    await page.route('**/bitrix/js/rest/applayout.js', (r) => {
      sdkRequested = true;
      if (/crm\.yurclick\.com/.test(r.request().url())) sdkFromCrm = true;
      r.fulfill({ status: 200, contentType: 'application/javascript', body: SDK_STUB });
    });
    await page.route('**/api.bitrix24.com/**', (r) => { r.fulfill({ status: 200, contentType: 'application/javascript', body: SDK_STUB }); });

    await page.goto(`http://127.0.0.1:${pport}/`, { waitUntil: 'networkidle' });

    const frame = page.frames().find(f => f.url().includes('/index.php'));
    let useWebhook = null, formShown = false, logUrl = null, appEnv = null;
    if (frame) {
      useWebhook = await frame.evaluate(() => window.APP_USE_WEBHOOK);
      logUrl = await frame.evaluate(() => window.APP_CONFIG && window.APP_CONFIG.logUrl);
      appEnv = await frame.evaluate(() => window.APP_CONFIG && window.APP_CONFIG.appEnv);
      await frame.waitForFunction(() => {
        const f = document.getElementById('anketa-form');
        return f && !f.classList.contains('hidden') && document.querySelector('#section-5-body input[type=radio]');
      }, { timeout: 8000 }).catch(() => {});
      formShown = await frame.evaluate(() => { const f = document.getElementById('anketa-form'); return !!(f && !f.classList.contains('hidden')); });
    }
    const sdkError = errors.some(e => /BX24 SDK не загружен|BX24 is not defined|BX24.*undefined/.test(e));
    // logUrl must point at logs.txt and must NOT carry DOMAIN/APP_SID/query/hash.
    const logUrlOk = !!logUrl && /\/logs\.txt$/.test(logUrl) && !/[?#]|DOMAIN|APP_SID/i.test(logUrl);

    console.log('\n--- Scenario B: INSIDE iframe (apcheit.ru, ?DOMAIN=crm.yurclick.com, no leadId) ---');
    console.log('frame found     =', !!frame, '(expect true)');
    console.log('APP_USE_WEBHOOK =', useWebhook, '(expect false)');
    console.log('appEnv          =', appEnv, '(expect "prod")');
    console.log('SDK requested   =', sdkRequested, '(expect true)');
    console.log('SDK from crm host=', sdkFromCrm, '(expect true)');
    console.log('webhook used    =', webhookUsed, '(expect false)');
    console.log('form shown      =', formShown, '(expect true)');
    console.log('SDK-error       =', sdkError, '(expect false)');
    console.log('logUrl          =', logUrl);
    console.log('logUrl OK       =', logUrlOk, '(expect true: ends /logs.txt, no query/DOMAIN)');
    if (errors.length) console.log('console errors:\n' + errors.join('\n'));

    if (!frame) failures.push('B: iframe with index.php not found');
    if (useWebhook !== false) failures.push('B: APP_USE_WEBHOOK !== false inside iframe');
    if (appEnv !== 'prod') failures.push('B: appEnv !== "prod" (DOMAIN override failed)');
    if (!sdkRequested) failures.push('B: SDK (applayout.js) not requested');
    if (!sdkFromCrm) failures.push('B: SDK not loaded from crm.yurclick.com portal');
    if (webhookUsed) failures.push('B: webhook used inside iframe');
    if (!formShown) failures.push('B: form did not render via SDK');
    if (sdkError) failures.push('B: SDK-not-loaded error appeared');
    if (!logUrlOk) failures.push('B: logUrl is wrong (does not point at logs.txt / carries query)');

    await page.close();
    psrv.close();
  }

  await browser.close();
  srv.close();

  console.log('\n=== RESULT ===');
  if (failures.length) { console.log('FAIL\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('PASS');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(2); });
