# Offline regression test for the left questionnaire panel

Reproduces the "click-jump" scenario (clicking radios while the form is
scrolled) without PHP or a live Bitrix24 portal.

`make-harness.js` strips the PHP from `index.php` and injects a `window.BX24`
stub returning a mock lead, producing `harness.test.html` (gitignored). The
test scripts load the real `assets/*.js` against that harness.

## Run

```bash
npm i -D playwright          # once; uses cached chromium if available
node test/run-test.js        # clicks radios across sections, asserts scroll delta == 0
node test/edgetest.js        # worst case: stop-factor toggles while scrolled to bottom
```

`run-test.js` exits non-zero if any click moves the scroll position by > 4px.
