// Verifies the index.php bootstrap mode-selection (added on v5-latest):
//   - OUTSIDE iframe on a PROD host  -> webhook-shim activates, lead loads via webhook.
//   - INSIDE iframe                  -> BX24 SDK <script> is injected (applayout.js),
//                                       page does NOT throw "BX24 SDK не загружен".
//
// No PHP is available in this environment, so we render index.php's PHP echoes
// with prod-like values in Node (portal = crm.yurclick.com, a FAKE webhook URL),
// then drive the result with Playwright. The real assets/*.js run unchanged.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const CHROME = '/home/user/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';

// Prod-like values. Webhook URL is FAKE (no real secret); requests are stubbed.
const PORTAL_URL = 'https://crm.yurclick.com';
const WEBHOOK_URL = 'https://crm.yurclick.com/rest/0/TESTONLYFAKEKEY';
const LEAD_ID = 12826;

function renderIndexProd() {
  let s = fs.readFileSync(path.join(ROOT, 'index.php'), 'utf8');
  s = s.slice(s.indexOf('<!DOCTYPE'));
  // Replace the server-rendered APP_CONFIG script wholesale with a prod stub.
  const cfg = `<script>
    window.APP_CONFIG = {
      salesDeptId: 1, bpTemplateId: 40, appEnv: "prod",
      slotMin: 60, horizonDays: 7, minSlots: 1,
      clientHrMin: 9, clientHrMax: 20, minMpPerDay: 3,
      webhookUrl: ${JSON.stringify(WEBHOOK_URL)},
      currentUser: { ID: 0, NAME: "", LAST_NAME: "", EMAIL: "" },
      logUrl: ""
    };
  </script>`;
  s = s.replace(/<script>\s*\n\s*window\.APP_CONFIG[\s\S]*?<\/script>/, cfg);
  // Substitute the portal URL echo used by the SDK-injection block.
  s = s.replace(/<\?=\s*json_encode\(\$portalUrl\)\s*\?>/g, JSON.stringify(PORTAL_URL));
  // Any remaining PHP echoes (none expected after the two above) -> empty.
  s = s.replace(/<\?(php|=)[\s\S]*?\?>/g, '""');
  // Drop the Yandex metrika block (network noise in test).
  s = s.replace(/<script type="text\/javascript">\s*\(function\(m,e,t,r,i,k,a\)[\s\S]*?<\/noscript>/, '<!-- metrika removed -->');
  return s;
}

function serve(html) {
  const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/' || p === '/index.php') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html); return;
      }
      const fp = path.join(ROOT, p);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(0, () => resolve(srv));
  });
}

// Minimal Bitrix24 REST webhook responder for the methods the form needs at load.
function webhookData(method) {
  if (method === 'crm.lead.get') {
    return { result: { ID: String(LEAD_ID), TITLE: 'Лид #' + LEAD_ID + ' (webhook)', CONTACT_ID: '0' } };
  }
  if (method === 'crm.lead.list') return { result: [], total: 0 };
  if (method.indexOf('calendar.') === 0) return { result: [] };
  if (method.indexOf('user.') === 0) return { result: [] };
  return { result: [] };
}

async function run() {
  const html = renderIndexProd();
  const srv = await serve(html);
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });

  let failures = [];

  // ── Scenario A: OUTSIDE iframe on prod host -> shim must load the lead ──────
  {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

    // Stub every webhook .json POST so no real network call to crm.yurclick.com happens.
    // Registered FIRST so the more-specific SDK routes below take precedence
    // (Playwright evaluates routes last-registered-first).
    await page.route('**/rest/**', (route) => {
      const url = route.request().url();
      const m = (url.match(/\/([a-z0-9_.]+)\.json/i) || [])[1] || '';
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(webhookData(m)) });
    });
    // applayout.js / api.bitrix24.com must NEVER be requested outside the iframe.
    let sdkRequested = false;
    await page.route('**/bitrix/js/rest/applayout.js', (r) => { sdkRequested = true; r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }); });
    await page.route('**/api.bitrix24.com/**', (r) => { sdkRequested = true; r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }); });

    await page.goto(`http://127.0.0.1:${port}/index.php?leadId=${LEAD_ID}`, { waitUntil: 'networkidle' });

    const useWebhook = await page.evaluate(() => window.APP_USE_WEBHOOK);
    const bxIsShim = await page.evaluate(() => !!(window.BX24_WEBHOOK && window.BX24 === window.BX24_WEBHOOK));
    // Form should render (lead loaded via webhook), no SDK-not-loaded error.
    await page.waitForFunction(() => {
      const f = document.getElementById('anketa-form');
      return f && !f.classList.contains('hidden') &&
             document.querySelector('#section-5-body input[type=radio]');
    }, { timeout: 8000 }).catch(() => {});
    const formShown = await page.evaluate(() => {
      const f = document.getElementById('anketa-form');
      return !!(f && !f.classList.contains('hidden'));
    });
    const sdkError = errors.some(e => /BX24 SDK не загружен|BX24 is not defined|BX24.*undefined/.test(e));

    console.log('--- Scenario A: OUTSIDE iframe (prod host) ---');
    console.log('APP_USE_WEBHOOK =', useWebhook, '(expect true)');
    console.log('BX24===shim     =', bxIsShim, '(expect true)');
    console.log('SDK requested   =', sdkRequested, '(expect false)');
    console.log('form shown      =', formShown, '(expect true)');
    console.log('SDK-error logged=', sdkError, '(expect false)');
    if (errors.length) console.log('console errors:\n' + errors.join('\n'));

    if (useWebhook !== true) failures.push('A: APP_USE_WEBHOOK !== true');
    if (!bxIsShim) failures.push('A: BX24 is not the webhook shim');
    if (sdkRequested) failures.push('A: SDK script was requested outside iframe');
    if (!formShown) failures.push('A: form did not render via webhook');
    if (sdkError) failures.push('A: "BX24 SDK не загружен" error appeared');
    await page.close();
  }

  // ── Scenario B: INSIDE iframe -> SDK injected, no "SDK не загружен" error ───
  {
    // The parent page hosts index.php in an iframe. We stub the applayout.js so
    // it installs a working window.BX24 (the box would serve the real one).
    const childUrl = `http://127.0.0.1:${port}/index.php?leadId=${LEAD_ID}`;
    const parentHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
      <body><iframe id="f" src="${childUrl}" style="width:900px;height:700px;border:0"></iframe></body></html>`;
    // Serve the parent from the same origin path so the iframe is same-origin.
    const psrv = await serve(parentHtml);
    const pport = psrv.address().port;

    const page = await browser.newPage({ viewport: { width: 950, height: 750 } });
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

    let sdkRequested = false;
    // applayout.js stub: define a minimal but functional BX24 SDK.
    const SDK_STUB = `(function(){window.BX24={init:function(cb){setTimeout(cb,0);},
      placement:{info:function(){return{placement:"CRM_LEAD_DETAIL_TAB",options:{ID:${LEAD_ID}}};}},
      callMethod:function(m,p,cb){var d={};if(m==="crm.lead.get")d={ID:"${LEAD_ID}",TITLE:"Лид (SDK)",CONTACT_ID:"0"};else if(m==="user.current")d={ID:"1",NAME:"Test"};else if(m==="user.get")d=[{ID:"1",NAME:"Test"}];else d=[];
      setTimeout(function(){cb&&cb({data:function(){return d;},error:function(){return false;},total:function(){return 0;},more:function(){return false;}});},0);return true;},
      callBatch:function(c,cb){var o={};Object.keys(c).forEach(function(k){var mm=c[k][0];var dd=(mm==="crm.lead.get")?{ID:"${LEAD_ID}",TITLE:"Лид (SDK)",CONTACT_ID:"0"}:(mm==="user.current"?{ID:"1",NAME:"Test"}:[]);o[k]={data:function(){return dd;},error:function(){return false;},total:function(){return 0;},more:function(){return false;}};});
      setTimeout(function(){cb&&cb(o);},0);return true;},
      callBind:function(){return true;},callUnbind:function(){return true;},installFinish:function(){},getAuth:function(){return {access_token:"x"};},fitWindow:function(){},resizeWindow:function(){}};})();`;
    // Webhook must NOT be used inside the iframe. Registered FIRST; the specific
    // SDK routes below take precedence (last-registered-first).
    let webhookUsed = false;
    await page.route('**/rest/**', (r) => {
      webhookUsed = true; r.fulfill({ status: 200, contentType: 'application/json', body: '{"result":[]}' });
    });
    await page.route('**/bitrix/js/rest/applayout.js', (r) => { sdkRequested = true; r.fulfill({ status: 200, contentType: 'application/javascript', body: SDK_STUB }); });
    await page.route('**/api.bitrix24.com/**', (r) => { r.fulfill({ status: 200, contentType: 'application/javascript', body: SDK_STUB }); });

    await page.goto(`http://127.0.0.1:${pport}/`, { waitUntil: 'networkidle' });

    const frame = page.frames().find(f => f.url().includes('/index.php'));
    let useWebhook = null, formShown = false;
    if (frame) {
      useWebhook = await frame.evaluate(() => window.APP_USE_WEBHOOK);
      await frame.waitForFunction(() => {
        const f = document.getElementById('anketa-form');
        return f && !f.classList.contains('hidden') &&
               document.querySelector('#section-5-body input[type=radio]');
      }, { timeout: 8000 }).catch(() => {});
      formShown = await frame.evaluate(() => {
        const f = document.getElementById('anketa-form');
        return !!(f && !f.classList.contains('hidden'));
      });
    }
    const sdkError = errors.some(e => /BX24 SDK не загружен|BX24 is not defined|BX24.*undefined/.test(e));

    console.log('\n--- Scenario B: INSIDE iframe ---');
    console.log('frame found     =', !!frame, '(expect true)');
    console.log('APP_USE_WEBHOOK =', useWebhook, '(expect false)');
    console.log('SDK requested   =', sdkRequested, '(expect true)');
    console.log('webhook used    =', webhookUsed, '(expect false)');
    console.log('form shown      =', formShown, '(expect true)');
    console.log('SDK-error logged=', sdkError, '(expect false)');
    if (errors.length) console.log('console errors:\n' + errors.join('\n'));

    if (!frame) failures.push('B: iframe with index.php not found');
    if (useWebhook !== false) failures.push('B: APP_USE_WEBHOOK !== false inside iframe');
    if (!sdkRequested) failures.push('B: SDK script (applayout.js) was not requested');
    if (webhookUsed) failures.push('B: webhook was used inside iframe');
    if (!formShown) failures.push('B: form did not render via SDK');
    if (sdkError) failures.push('B: "BX24 SDK не загружен" error appeared');

    await page.close();
    psrv.close();
  }

  await browser.close();
  srv.close();

  console.log('\n=== RESULT ===');
  if (failures.length) {
    console.log('FAIL\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log('PASS');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(2); });
