'use strict';
/* DOM smoke test: drives the real app in jsdom through the main user flows. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html')
  .replace(/<link[^>]*fonts[^>]*>/g, '')
  .replace(/<script src="vendor\/html2canvas[^"]*"><\/script>/, '')
  .replace(/<script src="vendor\/jspdf[^"]*"><\/script>/, '')
  .replace(/<script src="js\//g, '<script src="FILE://js/');

const dom = new JSDOM(html, {
  url: 'http://localhost/fatora/',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});
const { window } = dom;

// localStorage shim is built into jsdom. Fire the scripts manually in order.
for (const f of ['js/core.js', 'js/i18n.js', 'js/store.js', 'js/app.js']) {
  window.eval(read(f));
}

const assert = require('node:assert/strict');
const $ = s => window.document.querySelector(s);
const $$ = s => Array.from(window.document.querySelectorAll(s));
const setVal = (sel, v) => { const el = $(sel); el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); el.dispatchEvent(new window.Event('change', { bubbles: true })); };

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('ok -', name); }
  catch (e) { failures++; console.log('FAIL -', name, '::', e.message); }
}

check('boots into dashboard (Arabic RTL default)', () => {
  assert.equal(window.document.documentElement.lang, 'ar');
  assert.equal(window.document.documentElement.dir, 'rtl');
  assert.ok($('.empty'), 'empty state visible');
});

check('creates an invoice via #/new/invoice', () => {
  window.location.hash = '#/new/invoice';
  window.dispatchEvent(new window.Event('hashchange'));
  assert.ok($('#e-cname'), 'editor form present');
  assert.ok($('.sheet'), 'live preview present');
  assert.match($('.editor-head h2').textContent, /INV-0001/);
});

check('fills client + items and preview updates', () => {
  setVal('#e-cname', 'شركة النيل للتجارة');
  const desc = $('.item-row .i-desc'); desc.value = 'تصميم شعار'; desc.dispatchEvent(new window.Event('input', { bubbles: true }));
  const qty = $('.item-row .i-qty'); qty.value = '2'; qty.dispatchEvent(new window.Event('input', { bubbles: true }));
  const price = $('.item-row .i-price'); price.value = '150'; price.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.ok($('.sheet-to strong').textContent.includes('النيل'));
  assert.ok($('.sheet-totals .grand span:last-child').textContent.length > 0);
  const sub = $('.sheet-totals > div:first-child span:last-child').textContent;
  assert.ok(/٣٠٠|300/.test(sub), 'subtotal 300 in preview, got: ' + sub);
});

check('adds a second item row and removes it', () => {
  $('#e-additem').click();
  assert.equal($$('#e-items .item-row').length, 2);
  $$('#e-items .item-row')[1].querySelector('.i-del').click();
  assert.equal($$('#e-items .item-row').length, 1);
});

check('discount + tax reflected in totals', () => {
  setVal('#e-disctype', 'percent');
  setVal('#e-discval', '10');
  setVal('#e-tax', '14');
  const grand = $('.sheet-totals .grand span:last-child').textContent;
  assert.ok(/٣٠٧٫٨|307\.8/.test(grand), 'total = 300-30=270 *1.14 = 307.8, got ' + grand);
});

check('state persists to localStorage', () => {
  const raw = window.localStorage.getItem('fatora.v1');
  assert.ok(raw, 'state saved');
  const state = JSON.parse(raw);
  assert.equal(state.docs.length, 1);
});

check('back to dashboard lists the invoice with totals', () => {
  window.location.hash = '#/';
  window.dispatchEvent(new window.Event('hashchange'));
  assert.equal($$('.doccard').length, 1);
  assert.ok($('.doccard-client').textContent.includes('النيل'));
});

check('status filter works', () => {
  setVal('#f-status', 'paid');
  assert.ok($('.empty.small') || $$('.doccard').length === 0, 'paid filter hides draft invoice');
  setVal('#f-status', 'all');
  assert.equal($$('.doccard').length, 1);
});

check('language toggle switches UI to English LTR', () => {
  $('#lang-toggle').click();
  assert.equal(window.document.documentElement.lang, 'en');
  assert.equal(window.document.documentElement.dir, 'ltr');
  assert.ok($('.doccard').textContent.includes('INV-0001'));
  $('#lang-toggle').click();
  assert.equal(window.document.documentElement.lang, 'ar');
});

check('settings screen edits branding and renumbers', () => {
  window.location.hash = '#/settings';
  window.dispatchEvent(new window.Event('hashchange'));
  setVal('#s-name', 'محل البركة');
  setVal('#s-accent', '#8e2f5a');
  setVal('#s-currency', 'SAR');
  assert.equal(window.document.documentElement.style.getPropertyValue('--accent'), '#8e2f5a');
  window.location.hash = '#/';
  window.dispatchEvent(new window.Event('hashchange'));
  assert.ok($('.brand-text strong').textContent.includes('البركة'));
});

check('quote creation uses quote sequence', () => {
  window.location.hash = '#/new/quote';
  window.dispatchEvent(new window.Event('hashchange'));
  assert.match($('.editor-head h2').textContent, /QTE-0001/);
  setVal('#e-cname', 'عميل العرض');
  const d = $('.item-row .i-desc'); d.value = 'صيانة'; d.dispatchEvent(new window.Event('input', { bubbles: true }));
  const p = $('.item-row .i-price'); p.value = '500'; p.dispatchEvent(new window.Event('input', { bubbles: true }));
});

check('quote converts to invoice with next invoice number', () => {
  $('#e-convert').click();
  window.dispatchEvent(new window.Event('hashchange')); // jsdom: hashchange is async
  assert.match($('.editor-head h2').textContent, /INV-0002/, 'new invoice number');
  assert.ok($('.sheet-meta h2').textContent.length > 0);
});

check('duplicate creates a draft copy', () => {
  $('#e-dup').click();
  window.dispatchEvent(new window.Event('hashchange')); // jsdom: hashchange is async
  assert.match($('.editor-head h2').textContent, /INV-0003/);
  window.location.hash = '#/';
  window.dispatchEvent(new window.Event('hashchange'));
  assert.equal($$('.doccard').length, 4);
});

check('search narrows the list', () => {
  setVal('#f-q', 'البركة'); // business name, not a client
  assert.ok($$('.doccard').length === 0 || $('.empty.small'));
  setVal('#f-q', 'النيل');
  assert.equal($$('.doccard').length, 1);
  setVal('#f-q', '');
});

check('delete removes a document', () => {
  window.confirm = () => true;
  $('.doccard .mini.danger').click();
  assert.equal($$('.doccard').length, 3);
});

setTimeout(() => {
  check('settings + docs survive a reload', () => {
    const raw = window.localStorage.getItem('fatora.v1');
    const state = JSON.parse(raw);
    assert.equal(state.settings.businessName, 'محل البركة');
    assert.equal(state.settings.currency, 'SAR');
    assert.equal(state.docs.length, 3);
    const inv1 = state.docs.find(d => d.number === 'INV-0001');
    assert.equal(inv1.client.name, 'شركة النيل للتجارة');
    assert.equal(state.settings.invoiceSeq, 4);
    assert.equal(state.settings.quoteSeq, 2);
  });
  console.log(failures ? `\n${failures} FAILURES` : '\nALL SMOKE TESTS PASSED');
  process.exit(failures ? 1 : 0);
}, 900);
