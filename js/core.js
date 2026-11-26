/* Fatora core logic — pure functions, shared by the browser app and the Node tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FatoraCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY = 'fatora.v1';

  var CURRENCIES = ['EGP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD', 'USD', 'EUR', 'GBP'];

  var DOC_TYPES = ['invoice', 'quote'];

  var INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue'];
  var QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected'];

  /* ---------- ids ---------- */
  function uid() {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  /* ---------- money: integer-cents math, round half up ---------- */
  function round2(n) {
    if (!isFinite(n)) return 0;
    return (Math.round((n + Number.EPSILON) * 100) / 100);
  }

  function toNumber(v, fallback) {
    var n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
    return isFinite(n) ? n : (fallback || 0);
  }

  function clampNonNegative(n) { return n < 0 ? 0 : n; }

  /**
   * Compute totals for a document.
   * items: [{qty, price}]
   * opts: {discountType: 'none'|'percent'|'fixed', discountValue, taxRate (percent)}
   * Returns {subtotal, discount, tax, total} all rounded to 2dp.
   * Discount is applied before tax. Total never goes below 0.
   */
  function computeTotals(items, opts) {
    opts = opts || {};
    var subtotal = 0;
    (items || []).forEach(function (it) {
      if (!it) return;
      var qty = clampNonNegative(toNumber(it.qty));
      var price = clampNonNegative(toNumber(it.price));
      subtotal += qty * price;
    });
    subtotal = round2(subtotal);

    var discount = 0;
    var dv = clampNonNegative(toNumber(opts.discountValue));
    if (opts.discountType === 'percent') discount = subtotal * Math.min(dv, 100) / 100;
    else if (opts.discountType === 'fixed') discount = Math.min(dv, subtotal);
    discount = round2(discount);

    var taxable = round2(Math.max(0, subtotal - discount));
    var taxRate = clampNonNegative(toNumber(opts.taxRate));
    var tax = round2(taxable * taxRate / 100);

    var total = round2(taxable + tax);
    return { subtotal: subtotal, discount: discount, tax: tax, total: total };
  }

  function lineTotal(item) {
    return round2(clampNonNegative(toNumber(item.qty)) * clampNonNegative(toNumber(item.price)));
  }

  /* ---------- numbering ---------- */
  function pad(n, width) {
    var s = String(Math.max(0, Math.floor(n)));
    while (s.length < width) s = '0' + s;
    return s;
  }

  function formatNumber(prefix, seq) {
    return (prefix || '') + pad(seq, 4);
  }

  /** Parse the trailing digits of a document number; returns null when none. */
  function parseSeq(number, prefix) {
    if (typeof number !== 'string') return null;
    if (prefix && number.indexOf(prefix) !== 0) return null;
    var rest = prefix ? number.slice(prefix.length) : number;
    var m = rest.match(/^(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
  }

  /* ---------- defaults & factories ---------- */
  function defaultSettings() {
    return {
      businessName: '',
      tagline: '',
      phone: '',
      email: '',
      address: '',
      logo: '',               // data URL, set from settings screen
      accent: '#0e7c66',      // brand color
      currency: 'EGP',
      language: 'ar',         // UI + default document language
      taxRate: 14,
      invoicePrefix: 'INV-',
      quotePrefix: 'QTE-',
      invoiceSeq: 1,
      quoteSeq: 1,
      dueDays: 14,
      terms: '',
      footer: ''
    };
  }

  function newItem() {
    return { id: uid(), description: '', qty: 1, price: 0 };
  }

  function newClient() {
    return { id: uid(), name: '', phone: '', email: '', address: '' };
  }

  function newDoc(type, settings) {
    var today = toISODate(new Date());
    return {
      id: uid(),
      type: type === 'quote' ? 'quote' : 'invoice',
      number: '',
      status: 'draft',
      issueDate: today,
      dueDate: addDays(today, settings ? toNumber(settings.dueDays, 14) : 14),
      language: settings ? settings.language : 'ar',
      client: newClient(),
      items: [newItem()],
      discountType: 'none',
      discountValue: 0,
      taxRate: settings ? toNumber(settings.taxRate, 0) : 0,
      amountPaid: 0,
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  /* ---------- dates ---------- */
  function toISODate(d) {
    var y = d.getFullYear(), m = pad(d.getMonth() + 1, 2), day = pad(d.getDate(), 2);
    return y + '-' + m + '-' + day;
  }

  function addDays(iso, days) {
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    d.setDate(d.getDate() + Math.floor(toNumber(days)));
    return toISODate(d);
  }

  function isOverdue(doc) {
    if (!doc || doc.type !== 'invoice') return false;
    if (doc.status === 'paid' || doc.status === 'draft') return false;
    if (!doc.dueDate) return false;
    return doc.dueDate < toISODate(new Date());
  }

  /* ---------- validation ---------- */
  function validateDoc(doc) {
    var errors = [];
    if (!doc) { errors.push('doc'); return errors; }
    if (!doc.client || !String(doc.client.name || '').trim()) errors.push('clientName');
    var hasItem = (doc.items || []).some(function (it) {
      return String(it.description || '').trim() && toNumber(it.qty) > 0;
    });
    if (!hasItem) errors.push('items');
    if (doc.type !== 'invoice' && doc.type !== 'quote') errors.push('type');
    return errors;
  }

  /* ---------- formatting ---------- */
  function formatMoney(amount, currency, language) {
    var locale = language === 'ar' ? 'ar-EG' : 'en-US';
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: currency || 'EGP' }).format(toNumber(amount));
    } catch (e) {
      return round2(amount).toFixed(2) + ' ' + (currency || '');
    }
  }

  function formatDate(iso, language) {
    var locale = language === 'ar' ? 'ar-EG' : 'en-GB';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso || '';
    try {
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    } catch (e) { return iso; }
  }

  /* ---------- persistence-safe serialization ---------- */
  function serialize(state) {
    return JSON.stringify(state, null, 2);
  }

  /** Parse and sanitize an imported state/settings payload. Returns null when invalid. */
  function sanitizeImported(data, kind) {
    if (!data || typeof data !== 'object') return null;
    if (kind === 'settings') {
      var s = defaultSettings();
      Object.keys(s).forEach(function (k) {
        if (data[k] !== undefined && typeof data[k] === typeof s[k]) s[k] = data[k];
      });
      if (CURRENCIES.indexOf(s.currency) < 0) s.currency = 'EGP';
      if (s.language !== 'ar' && s.language !== 'en') s.language = 'ar';
      if (!/^#[0-9a-fA-F]{6}$/.test(s.accent)) s.accent = '#0e7c66';
      return s;
    }
    if (kind === 'backup') {
      if (!Array.isArray(data.docs) || !data.settings) return null;
      var settings = sanitizeImported(data.settings, 'settings');
      var docs = data.docs.filter(function (d) {
        return d && typeof d === 'object' && (d.type === 'invoice' || d.type === 'quote') && Array.isArray(d.items);
      }).map(function (d) {
        var clean = newDoc(d.type, settings);
        Object.keys(clean).forEach(function (k) {
          if (d[k] !== undefined && typeof d[k] === typeof clean[k]) clean[k] = d[k];
        });
        clean.id = typeof d.id === 'string' && d.id ? d.id : uid();
        clean.client = Object.assign(newClient(), d.client || {});
        clean.items = d.items.map(function (it) {
          return {
            id: typeof it.id === 'string' && it.id ? it.id : uid(),
            description: String(it.description || ''),
            qty: clampNonNegative(toNumber(it.qty)),
            price: clampNonNegative(toNumber(it.price))
          };
        });
        return clean;
      });
      var clients = Array.isArray(data.clients) ? data.clients.filter(function (c) {
        return c && typeof c === 'object' && typeof c.name === 'string' && c.name.trim();
      }).map(function (c) {
        return {
          id: typeof c.id === 'string' && c.id ? c.id : uid(),
          name: String(c.name || ''), phone: String(c.phone || ''),
          email: String(c.email || ''), address: String(c.address || '')
        };
      }) : [];
      return { settings: settings, docs: docs, clients: clients };
    }
    return null;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    CURRENCIES: CURRENCIES,
    DOC_TYPES: DOC_TYPES,
    INVOICE_STATUSES: INVOICE_STATUSES,
    QUOTE_STATUSES: QUOTE_STATUSES,
    uid: uid,
    round2: round2,
    toNumber: toNumber,
    computeTotals: computeTotals,
    lineTotal: lineTotal,
    pad: pad,
    formatNumber: formatNumber,
    parseSeq: parseSeq,
    defaultSettings: defaultSettings,
    newItem: newItem,
    newClient: newClient,
    newDoc: newDoc,
    toISODate: toISODate,
    addDays: addDays,
    isOverdue: isOverdue,
    validateDoc: validateDoc,
    formatMoney: formatMoney,
    formatDate: formatDate,
    serialize: serialize,
    sanitizeImported: sanitizeImported
  };
});
