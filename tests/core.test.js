'use strict';
/* Fatora unit tests — run: node --test tests/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/core.js');
const I18N = require('../js/i18n.js');

test('computeTotals: simple sum', () => {
  const t = Core.computeTotals([{ qty: 2, price: 50 }, { qty: 1, price: 25 }], { taxRate: 0 });
  assert.equal(t.subtotal, 125);
  assert.equal(t.tax, 0);
  assert.equal(t.total, 125);
});

test('computeTotals: percent discount applies before tax', () => {
  const t = Core.computeTotals([{ qty: 1, price: 200 }], { discountType: 'percent', discountValue: 10, taxRate: 14 });
  assert.equal(t.subtotal, 200);
  assert.equal(t.discount, 20);
  assert.equal(t.tax, 25.2); // 180 * 14%
  assert.equal(t.total, 205.2);
});

test('computeTotals: fixed discount caps at subtotal', () => {
  const t = Core.computeTotals([{ qty: 1, price: 100 }], { discountType: 'fixed', discountValue: 500, taxRate: 10 });
  assert.equal(t.discount, 100);
  assert.equal(t.tax, 0);
  assert.equal(t.total, 0);
});

test('computeTotals: percent discount caps at 100', () => {
  const t = Core.computeTotals([{ qty: 1, price: 100 }], { discountType: 'percent', discountValue: 250, taxRate: 10 });
  assert.equal(t.discount, 100);
  assert.equal(t.total, 0);
});

test('computeTotals: negative qty and price clamp to zero', () => {
  const t = Core.computeTotals([{ qty: -3, price: -20 }], { taxRate: 14 });
  assert.equal(t.subtotal, 0);
  assert.equal(t.total, 0);
});

test('computeTotals: rounding is half-up to 2dp', () => {
  const t = Core.computeTotals([{ qty: 3, price: 33.335 }], { taxRate: 0 });
  assert.equal(t.subtotal, 100.01); // 100.005 -> 100.01
});

test('computeTotals: accepts comma decimal strings', () => {
  const t = Core.computeTotals([{ qty: '2', price: '10,5' }], { taxRate: 0 });
  assert.equal(t.subtotal, 21);
});

test('computeTotals: garbage input yields zeros, never NaN', () => {
  const t = Core.computeTotals([{ qty: 'abc', price: null }, undefined], { discountValue: 'x', taxRate: NaN });
  assert.equal(t.subtotal, 0);
  assert.equal(t.total, 0);
});

test('lineTotal matches row math', () => {
  assert.equal(Core.lineTotal({ qty: 4, price: 12.5 }), 50);
  assert.equal(Core.lineTotal({ qty: 0.5, price: 99.99 }), 50);
});

test('numbering: format and parse round-trip', () => {
  assert.equal(Core.formatNumber('INV-', 7), 'INV-0007');
  assert.equal(Core.formatNumber('', 42), '0042');
  assert.equal(Core.parseSeq('INV-0007', 'INV-'), 7);
  assert.equal(Core.parseSeq('QTE-0007', 'INV-'), null);
  assert.equal(Core.parseSeq('INV-x', 'INV-'), null);
});

test('pad: zero-pads and never truncates', () => {
  assert.equal(Core.pad(5, 4), '0005');
  assert.equal(Core.pad(12345, 4), '12345');
});

test('addDays: rolls over month ends', () => {
  assert.equal(Core.addDays('2026-01-30', 3), '2026-02-02');
  assert.equal(Core.addDays('2026-12-31', 1), '2027-01-01');
});

test('isOverdue: only sent invoices past due date', () => {
  const yesterday = Core.toISODate(new Date(Date.now() - 86400000));
  const tomorrow = Core.toISODate(new Date(Date.now() + 86400000));
  assert.equal(Core.isOverdue({ type: 'invoice', status: 'sent', dueDate: yesterday }), true);
  assert.equal(Core.isOverdue({ type: 'invoice', status: 'paid', dueDate: yesterday }), false);
  assert.equal(Core.isOverdue({ type: 'invoice', status: 'draft', dueDate: yesterday }), false);
  assert.equal(Core.isOverdue({ type: 'invoice', status: 'sent', dueDate: tomorrow }), false);
  assert.equal(Core.isOverdue({ type: 'quote', status: 'sent', dueDate: yesterday }), false);
});

test('validateDoc: needs client name and one real item', () => {
  const doc = Core.newDoc('invoice', Core.defaultSettings());
  assert.ok(Core.validateDoc(doc).includes('clientName'));
  assert.ok(Core.validateDoc(doc).includes('items'));
  doc.client.name = 'شركة النيل';
  doc.items[0].description = 'استشارة';
  doc.items[0].qty = 1;
  assert.deepEqual(Core.validateDoc(doc), []);
});

test('newDoc: respects settings defaults', () => {
  const s = Core.defaultSettings();
  s.taxRate = 5; s.dueDays = 30; s.language = 'en';
  const d = Core.newDoc('quote', s);
  assert.equal(d.type, 'quote');
  assert.equal(d.taxRate, 5);
  assert.equal(d.language, 'en');
  assert.equal(d.dueDate, Core.addDays(d.issueDate, 30));
  assert.equal(d.status, 'draft');
  assert.equal(d.items.length, 1);
});

test('formatMoney: renders in both locales without throwing', () => {
  assert.ok(Core.formatMoney(1234.5, 'EGP', 'ar').length > 0);
  assert.ok(Core.formatMoney(1234.5, 'USD', 'en').includes('1,234.5'));
  assert.ok(Core.formatMoney('not-a-number', 'EGP', 'en').length > 0);
});

test('formatDate: renders readable dates, passes through garbage', () => {
  assert.ok(Core.formatDate('2026-02-08', 'en').includes('2026'));
  assert.ok(Core.formatDate('2026-02-08', 'ar').length > 0);
  assert.equal(Core.formatDate('junk', 'en'), 'junk');
});

test('sanitizeImported settings: keeps valid, drops wrong types and bad values', () => {
  const s = Core.sanitizeImported({
    businessName: 'محل البركة', accent: 'red', currency: 'XXX', language: 'fr',
    taxRate: '14', invoicePrefix: 'ف-', invoiceSeq: 12
  }, 'settings');
  assert.equal(s.businessName, 'محل البركة');
  assert.equal(s.accent, '#0e7c66');     // invalid color -> default
  assert.equal(s.currency, 'EGP');       // unknown currency -> default
  assert.equal(s.language, 'ar');        // unsupported lang -> default
  assert.equal(s.taxRate, 14);           // string-typed value rejected, default kept
});

test('sanitizeImported settings: defaults when junk', () => {
  assert.deepEqual(Core.sanitizeImported(null, 'settings'), null);
  assert.deepEqual(Core.sanitizeImported('x', 'settings'), null);
});

test('sanitizeImported backup: rejects non-backup, cleans docs', () => {
  assert.equal(Core.sanitizeImported({ hello: 1 }, 'backup'), null);
  const good = Core.sanitizeImported({
    settings: { businessName: 'Test Co', currency: 'USD', language: 'en', accent: '#112233', taxRate: 5, invoiceSeq: 3, quoteSeq: 2 },
    docs: [
      { type: 'invoice', number: 'INV-0001', status: 'paid', client: { name: 'A' }, items: [{ description: 'x', qty: 2, price: 10 }], taxRate: 5 },
      { type: 'weird', items: [] },
      null
    ],
    clients: [{ name: 'A', phone: '1' }, { name: '  ' }, { noName: true }]
  }, 'backup');
  assert.equal(good.docs.length, 1);
  assert.equal(good.docs[0].type, 'invoice');
  assert.equal(good.docs[0].items[0].qty, 2);
  assert.equal(good.clients.length, 1);
  assert.equal(good.settings.currency, 'USD');
});

test('serialize: round-trips through sanitize', () => {
  const state = { settings: Core.defaultSettings(), docs: [], clients: [] };
  state.settings.businessName = 'Round Trip';
  const back = Core.sanitizeImported(JSON.parse(Core.serialize(state)), 'backup');
  assert.equal(back.settings.businessName, 'Round Trip');
});

test('toCsv: header, escaping and totals', () => {
  const s = Core.defaultSettings();
  const doc = Core.newDoc('invoice', s);
  doc.number = 'INV-0001';
  doc.client.name = 'ACME, Inc. "East"';
  doc.items = [{ id: 'x', description: 'a', qty: 2, price: 10 }];
  doc.taxRate = 10;
  const csv = Core.toCsv([doc, null], 'EGP');
  const lines = csv.replace('\ufeff', '').split('\r\n');
  assert.equal(lines.length, 2); // header + 1 doc (null skipped)
  assert.ok(lines[0].startsWith('type,number,status'));
  assert.ok(lines[1].includes('INV-0001'));
  assert.ok(lines[1].includes('"ACME, Inc. ""East"""'));
  assert.ok(lines[1].includes('22.00')); // total 20 + 10% tax
  assert.ok(lines[1].endsWith('EGP'));
});

test('i18n: ar/en dictionaries have identical key sets', () => {
  const en = Object.keys(I18N.DICT.en).sort();
  const ar = Object.keys(I18N.DICT.ar).sort();
  assert.deepEqual(ar, en);
});

test('i18n: no empty translations', () => {
  for (const lang of ['en', 'ar']) {
    for (const [k, v] of Object.entries(I18N.DICT[lang])) {
      assert.ok(String(v).trim().length > 0, `${lang}.${k} is empty`);
    }
  }
});

test('i18n: t falls back to en then to key', () => {
  assert.equal(I18N.t('ar', 'invoice'), 'فاتورة');
  assert.equal(I18N.t('xx', 'invoice'), 'Invoice');
  assert.equal(I18N.t('en', 'missing-key'), 'missing-key');
});

test('i18n: dir is rtl only for ar', () => {
  assert.equal(I18N.dir('ar'), 'rtl');
  assert.equal(I18N.dir('en'), 'ltr');
});
