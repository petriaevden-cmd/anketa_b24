// Serves the repo root and drives harness.test.html with Playwright to
// reproduce / verify the "click-jump" bug in the left questionnaire panel.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };

// Rebuild the offline harness from the current index.php before each run.
require('child_process').execSync('node ' + path.join(__dirname, 'make-harness.js'), { stdio: 'inherit' });

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/harness.test.html';
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

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const url = `http://127.0.0.1:${port}/harness.test.html?leadId=12826`;

  const browser = await chromium.launch({
    executablePath: '/home/user/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell'
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto(url, { waitUntil: 'networkidle' });

  // NOFIX=1 neutralizes the fix to prove the regression reproduces: forces the
  // sr-only radio label wrappers back to position:static (their containing
  // block becomes the page ICB, restoring the window-level jump).
  if (process.env.NOFIX === '1') {
    await page.addStyleTag({ content:
      '#anketa-form label:has(> input.sr-only){position:static !important}' });
    console.log('[NOFIX mode] forced label wrappers to position:static');
  }

  // Wait for the form to be rendered (section bodies filled by form-init.js).
  await page.waitForFunction(() => {
    const f = document.getElementById('anketa-form');
    return f && !f.classList.contains('hidden') &&
           document.querySelector('#section-5-body input[type=radio]');
  }, { timeout: 8000 }).catch(() => {});

  const form = await page.$('#anketa-form');
  if (!form) { console.log('FORM NOT FOUND'); console.log(errors.join('\n')); await browser.close(); srv.close(); process.exit(2); }

  // Resolve the actual scroll container: the nearest scrollable ancestor of
  // the form (the wrapper div in the new structure, or the form itself in the
  // old structure). This keeps the test valid across both layouts.
  await page.evaluate(() => {
    window.__scroller = function () {
      let el = document.getElementById('anketa-form');
      while (el && el !== document.body) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 4) return el;
        el = el.parentElement;
      }
      return document.getElementById('anketa-form');
    };
  });

  // Scroll partway down so mid/lower radios are in view.
  await page.evaluate(() => { window.__scroller().scrollTop = 600; });
  await page.waitForTimeout(100);

  // Radios to click: name+value pairs across mid/lower sections.
  const targets = [
    ['mortgage','Y'], ['mortgage','N'],
    ['collateral','Y'],
    ['property','Y'], ['property','N'],
    ['deals','Y'],
    ['jointProperty','Y'],
    ['ooo','Y'],
    ['criminal','Y'],
    ['forOther','Y'], ['otherCompanyAS','Y'],
    ['fssp','Y'], ['deposit','Y'],
  ];

  const winScroll = () => page.evaluate(() =>
    Math.round(window.scrollY || document.scrollingElement.scrollTop || 0));
  const scrollerTop = () => page.evaluate(() => Math.round(window.__scroller().scrollTop));

  const results = [];
  for (const [name, val] of targets) {
    const sel = `#anketa-form input[name="${name}"][value="${val}"]`;
    const exists = await page.$(sel);
    if (!exists) { results.push({ name, val, status: 'MISSING' }); continue; }

    // Scroll the corresponding label into the middle of the viewport first.
    await page.evaluate((s) => {
      const inp = document.querySelector(s);
      const label = inp.closest('label') || inp.parentElement;
      const sc = window.__scroller();
      const r = label.getBoundingClientRect();
      const fr = sc.getBoundingClientRect();
      sc.scrollTop += (r.top - fr.top) - sc.clientHeight / 2;
      window.scrollTo(0, 0); // reset any window-level scroll between trials
    }, sel);
    await page.waitForTimeout(60);

    const beforeSc = await scrollerTop();
    const beforeWin = await winScroll();

    // Real mouse click on the visible label span (faithfully drives the
    // focus-into-view behavior that caused the window-level jump).
    const box = await page.evaluate((s) => {
      const inp = document.querySelector(s);
      const span = inp.closest('label').querySelector('span') || inp.closest('label');
      const r = span.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, sel);
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(120);

    const afterSc = await scrollerTop();
    const afterWin = await winScroll();
    const checked = await page.evaluate((s) => document.querySelector(s).checked, sel);

    results.push({
      name, val,
      dScroller: afterSc - beforeSc,
      dWindow: afterWin - beforeWin,
      winAfter: afterWin,
      checked,
    });
  }

  // Verify a conditional block expanded (mortgage Y -> block-mortgage visible).
  const condChecks = await page.evaluate(() => {
    const out = {};
    const ids = ['block-mortgage','block-collateral','block-property','block-deals','block-joint','block-ooo','block-criminal'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      out[id] = el ? !el.classList.contains('hidden') : 'no-el';
    });
    return out;
  });

  // Verify status widget updated.
  const statusText = await page.evaluate(() => {
    const b = document.getElementById('target-status-badge');
    return b ? b.textContent.trim() : null;
  });

  console.log('=== CONSOLE ERRORS ===');
  console.log(errors.length ? errors.join('\n') : '(none)');
  console.log('\n=== CLICK SCROLL DELTAS (scroller + window) ===');
  let maxScroller = 0, maxWindow = 0, notChecked = 0;
  for (const r of results) {
    if (r.status === 'MISSING') { console.log(`${r.name}=${r.val}: MISSING`); continue; }
    maxScroller = Math.max(maxScroller, Math.abs(r.dScroller));
    maxWindow = Math.max(maxWindow, Math.abs(r.dWindow));
    if (!r.checked) notChecked++;
    const flag = (Math.abs(r.dScroller) > 4 || Math.abs(r.dWindow) > 4) ? '  <-- JUMP' : '';
    console.log(`${r.name}=${r.val}: dScroller=${r.dScroller} dWindow=${r.dWindow} (winAfter=${r.winAfter}) checked=${r.checked}${flag}`);
  }
  console.log('\nMAX |dScroller| = ' + maxScroller + ' px');
  console.log('MAX |dWindow|   = ' + maxWindow + ' px');
  console.log('radios not checked after click: ' + notChecked);
  console.log('\n=== CONDITIONAL BLOCKS (true=visible) ===');
  console.log(JSON.stringify(condChecks, null, 0));
  console.log('\n=== STATUS BADGE ===');
  console.log(statusText);

  await browser.close();
  srv.close();

  // Fail if either the scroller OR the window jumps > 4px, or a click didn't
  // select the radio (regression in label↔input wiring).
  const ok = maxScroller <= 4 && maxWindow <= 4 && notChecked === 0;
  console.log('\nRESULT: ' + (ok ? 'PASS' : 'FAIL'));
  process.exit(ok ? 0 : 1);
})();
