/* Fatora app: hash-routed single-page UI. */
(function () {
  'use strict';
  var Core = window.FatoraCore;
  var I18N = window.FatoraI18n;
  var Store = window.FatoraStore;

  var state = Store.load();
  var ui = {
    route: { view: 'dashboard' },
    filter: { q: '', type: 'all', status: 'all' },
    editingId: null,
    editorTab: 'edit', // mobile tab
    saveTimer: null,
    toastTimer: null
  };

  /* ---------- helpers ---------- */
  function t(key) { return I18n_t(uiLang(), key); }
  function I18n_t(lang, key) { return I18N.t(lang, key); }
  function uiLang() { return state.settings.language === 'en' ? 'en' : 'ar'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, rootEl) { return (rootEl || document).querySelector(sel); }
  function $all(sel, rootEl) { return Array.prototype.slice.call((rootEl || document).querySelectorAll(sel)); }
  function money(n) { return Core.formatMoney(n, state.settings.currency, uiLang()); }
  function docMoney(n, doc) { return Core.formatMoney(n, state.settings.currency, doc.language); }

  function findDoc(id) {
    for (var i = 0; i < state.docs.length; i++) if (state.docs[i].id === id) return state.docs[i];
    return null;
  }

  function persist() { Store.save(state); }

  function scheduleSave() {
    clearTimeout(ui.saveTimer);
    ui.saveTimer = setTimeout(function () {
      persist();
      var el = $('#save-indicator');
      if (el) el.textContent = t('saved') + ' ' + new Date().toLocaleTimeString(uiLang() === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' });
    }, 450);
  }

  function toast(msg) {
    var el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  /* ---------- routing ---------- */
  function route() {
    var hash = location.hash || '#/';
    var m;
    if ((m = hash.match(/^#\/edit\/(.+)$/))) ui.route = { view: 'editor', id: m[1] };
    else if ((m = hash.match(/^#\/new\/(invoice|quote)$/))) ui.route = { view: 'new', type: m[1] };
    else if (hash === '#/settings') ui.route = { view: 'settings' };
    else ui.route = { view: 'dashboard' };
    render();
  }

  function go(hash) { location.hash = hash; }

  /* ---------- document operations ---------- */
  function createDoc(type) {
    var doc = Core.newDoc(type, state.settings);
    assignNumber(doc);
    state.docs.unshift(doc);
    persist();
    return doc;
  }

  function assignNumber(doc) {
    var s = state.settings;
    if (doc.number) return;
    if (doc.type === 'invoice') {
      doc.number = Core.formatNumber(s.invoicePrefix, s.invoiceSeq);
      s.invoiceSeq += 1;
    } else {
      doc.number = Core.formatNumber(s.quotePrefix, s.quoteSeq);
      s.quoteSeq += 1;
    }
  }

  function duplicateDoc(id) {
    var src = findDoc(id);
    if (!src) return;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = Core.uid();
    copy.number = '';
    copy.status = 'draft';
    copy.issueDate = Core.toISODate(new Date());
    copy.dueDate = Core.addDays(copy.issueDate, state.settings.dueDays);
    copy.createdAt = copy.updatedAt = new Date().toISOString();
    copy.items.forEach(function (it) { it.id = Core.uid(); });
    assignNumber(copy);
    state.docs.unshift(copy);
    persist();
    go('#/edit/' + copy.id);
  }

  function deleteDoc(id) {
    if (!confirm(t('confirmDelete'))) return;
    state.docs = state.docs.filter(function (d) { return d.id !== id; });
    persist();
    if (ui.route.view === 'editor') go('#/');
    else render();
  }

  function convertToInvoice(id) {
    var src = findDoc(id);
    if (!src || src.type !== 'quote') return;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = Core.uid();
    copy.type = 'invoice';
    copy.number = '';
    copy.status = 'draft';
    copy.issueDate = Core.toISODate(new Date());
    copy.dueDate = Core.addDays(copy.issueDate, state.settings.dueDays);
    copy.items.forEach(function (it) { it.id = Core.uid(); });
    assignNumber(copy);
    state.docs.unshift(copy);
    if (src.status === 'sent') src.status = 'accepted';
    persist();
    toast(t('quoteConverted'));
    go('#/edit/' + copy.id);
  }

  /* ---------- computed ---------- */
  function docTotals(doc) {
    return Core.computeTotals(doc.items, {
      discountType: doc.discountType,
      discountValue: doc.discountValue,
      taxRate: doc.taxRate
    });
  }

  function effectiveStatus(doc) {
    if (Core.isOverdue(doc)) return 'overdue';
    return doc.status;
  }

  function summary() {
    var invoiced = 0, collected = 0, openQuotes = 0;
    state.docs.forEach(function (d) {
      var tot = docTotals(d).total;
      if (d.type === 'invoice' && d.status !== 'draft') {
        invoiced += tot;
        collected += Math.min(Core.toNumber(d.amountPaid), tot);
      }
      if (d.type === 'quote' && (d.status === 'draft' || d.status === 'sent')) openQuotes += tot;
    });
    return {
      invoiced: Core.round2(invoiced),
      collected: Core.round2(collected),
      outstanding: Core.round2(Math.max(0, invoiced - collected)),
      openQuotes: Core.round2(openQuotes)
    };
  }

  function filteredDocs() {
    var q = ui.filter.q.trim().toLowerCase();
    return state.docs.filter(function (d) {
      if (ui.filter.type !== 'all' && d.type !== ui.filter.type) return false;
      if (ui.filter.status !== 'all' && effectiveStatus(d) !== ui.filter.status) return false;
      if (q) {
        var hay = (d.number + ' ' + (d.client.name || '') + ' ' + (d.client.phone || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  /* ---------- shell ---------- */
  function renderShell(content) {
    var s = state.settings;
    var brand = s.businessName || t('appName');
    var logoImg = s.logo
      ? '<img class="brand-logo" src="' + esc(s.logo) + '" alt="">'
      : '<span class="brand-mark" aria-hidden="true">' + logoSvg() + '</span>';
    return '' +
      '<header class="appbar">' +
        '<a class="brand" href="#/">' + logoImg +
          '<span class="brand-text"><strong>' + esc(brand) + '</strong>' +
          (s.tagline ? '<small>' + esc(s.tagline) + '</small>' : '') + '</span>' +
        '</a>' +
        '<div class="appbar-actions">' +
          '<button class="btn ghost" id="lang-toggle" title="' + (uiLang() === 'ar' ? 'English' : 'العربية') + '">' +
            (uiLang() === 'ar' ? 'EN' : 'عربي') + '</button>' +
          '<a class="btn ghost icon-btn" href="#/settings" title="' + esc(t('settings')) + '" aria-label="' + esc(t('settings')) + '">' + gearSvg() + '</a>' +
        '</div>' +
      '</header>' +
      '<main class="view">' + content + '</main>' +
      '<footer class="appfoot">' + esc(t('installHint')) + '</footer>';
  }

  function logoSvg() {
    return '<svg viewBox="0 0 96 96" width="34" height="34" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="14" y="6" width="58" height="74" rx="12" fill="var(--accent)"/>' +
      '<path d="M30 26h26M30 38h26M30 50h15" stroke="#fff" stroke-width="6" stroke-linecap="round"/>' +
      '<circle cx="66" cy="70" r="20" fill="#ffffff"/>' +
      '<path d="M57 70l7 7 13-15" stroke="var(--accent)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
  }

  function gearSvg() {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  }

  /* ---------- dashboard ---------- */
  function renderDashboard() {
    var sum = summary();
    var docs = filteredDocs();
    var statuses = ui.filter.type === 'quote' ? Core.QUOTE_STATUSES : (ui.filter.type === 'invoice' ? Core.INVOICE_STATUSES : ['draft', 'sent', 'paid', 'overdue', 'accepted', 'rejected']);

    var cards =
      '<section class="cards">' +
        card(t('totalInvoiced'), money(sum.invoiced), 'c1') +
        card(t('collected'), money(sum.collected), 'c2') +
        card(t('outstanding'), money(sum.outstanding), 'c3') +
        card(t('openQuotes'), money(sum.openQuotes), 'c4') +
      '</section>';

    var toolbar =
      '<section class="toolbar">' +
        '<input type="search" id="f-q" class="input grow" placeholder="' + esc(t('searchPlaceholder')) + '" value="' + esc(ui.filter.q) + '">' +
        '<select id="f-type" class="input">' +
          opt('all', t('allTypes'), ui.filter.type) + opt('invoice', t('invoices'), ui.filter.type) + opt('quote', t('quotes'), ui.filter.type) +
        '</select>' +
        '<select id="f-status" class="input">' +
          opt('all', t('allStatuses'), ui.filter.status) +
          statuses.map(function (st) { return opt(st, t(st), ui.filter.status); }).join('') +
        '</select>' +
        '<a class="btn primary" href="#/new/invoice">+ ' + esc(t('newInvoice')) + '</a>' +
        '<a class="btn soft" href="#/new/quote">+ ' + esc(t('newQuote')) + '</a>' +
      '</section>';

    var list;
    if (!state.docs.length) {
      list = '<section class="empty">' + emptySvg() +
        '<h2>' + esc(t('emptyTitle')) + '</h2><p>' + esc(t('emptyBody')) + '</p>' +
        '<a class="btn primary big" href="#/new/invoice">+ ' + esc(t('newInvoice')) + '</a></section>';
    } else if (!docs.length) {
      list = '<section class="empty small"><p>' + esc(t('noResults')) + '</p></section>';
    } else {
      list = '<section class="doclist">' + docs.map(docCard).join('') + '</section>';
    }

    return renderShell(cards + toolbar + list);
  }

  function card(label, value, cls) {
    return '<div class="stat ' + cls + '"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>';
  }

  function opt(v, label, cur) {
    return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
  }

  function docCard(d) {
    var tot = docTotals(d).total;
    var st = effectiveStatus(d);
    return '<article class="doccard" data-id="' + esc(d.id) + '">' +
      '<a class="doccard-main" href="#/edit/' + esc(d.id) + '">' +
        '<div class="doccard-top">' +
          '<span class="doctype">' + esc(t(d.type)) + '</span>' +
          '<span class="docnum">' + esc(d.number) + '</span>' +
          '<span class="pill st-' + esc(st) + '">' + esc(t(st)) + '</span>' +
        '</div>' +
        '<div class="doccard-client">' + esc(d.client.name || '—') + '</div>' +
        '<div class="doccard-meta"><span>' + esc(Core.formatDate(d.issueDate, uiLang())) + '</span>' +
        '<span>' + (d.items.length) + ' ' + esc(t(d.items.length === 1 ? 'item' : 'itemsCount')) + '</span></div>' +
      '</a>' +
      '<div class="doccard-side">' +
        '<strong class="doccard-total">' + esc(money(tot)) + '</strong>' +
        '<div class="doccard-actions">' +
          '<button class="mini" data-act="pdf" title="' + esc(t('downloadPdf')) + '">PDF</button>' +
          '<button class="mini" data-act="dup" title="' + esc(t('duplicate')) + '">⧉</button>' +
          '<button class="mini danger" data-act="del" title="' + esc(t('deleteDoc')) + '">✕</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function emptySvg() {
    return '<svg viewBox="0 0 120 120" width="110" height="110" fill="none" xmlns="http://www.w3.org/2000/svg" class="empty-art">' +
      '<rect x="28" y="14" width="56" height="74" rx="8" fill="var(--accent-soft)"/>' +
      '<rect x="38" y="28" width="36" height="5" rx="2.5" fill="var(--accent)" opacity=".7"/>' +
      '<rect x="38" y="40" width="28" height="4" rx="2" fill="var(--accent)" opacity=".4"/>' +
      '<rect x="38" y="50" width="32" height="4" rx="2" fill="var(--accent)" opacity=".4"/>' +
      '<rect x="38" y="60" width="22" height="4" rx="2" fill="var(--accent)" opacity=".4"/>' +
      '<circle cx="84" cy="82" r="17" fill="var(--accent)"/>' +
      '<path d="M84 74v16M76 82h16" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>' +
      '</svg>';
  }

  /* ---------- editor ---------- */
  function renderEditor(id) {
    var doc = findDoc(id);
    if (!doc) { go('#/'); return ''; }
    ui.editingId = id;
    var isInv = doc.type === 'invoice';
    var statuses = isInv ? Core.INVOICE_STATUSES : Core.QUOTE_STATUSES;

    var clientOpts = state.clients.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
    }).join('');

    var form =
      '<div class="editor-form' + (ui.editorTab === 'edit' ? ' active' : '') + '">' +

      '<section class="panel">' +
        '<h3>' + esc(t('client')) + '</h3>' +
        (state.clients.length ?
          '<label class="fld"><span>' + esc(t('savedClients')) + '</span>' +
          '<select id="e-client-pick" class="input"><option value="">—</option>' + clientOpts + '</select></label>' : '') +
        '<label class="fld"><span>' + esc(t('clientName')) + ' *</span>' +
          '<input id="e-cname" class="input" value="' + esc(doc.client.name) + '" placeholder="' + esc(t('clientNamePlaceholder')) + '"></label>' +
        '<div class="grid2">' +
          '<label class="fld"><span>' + esc(t('phone')) + '</span><input id="e-cphone" class="input" dir="ltr" value="' + esc(doc.client.phone) + '"></label>' +
          '<label class="fld"><span>' + esc(t('email')) + '</span><input id="e-cemail" class="input" dir="ltr" value="' + esc(doc.client.email) + '"></label>' +
        '</div>' +
        '<label class="fld"><span>' + esc(t('address')) + '</span><input id="e-caddr" class="input" value="' + esc(doc.client.address) + '"></label>' +
        '<label class="check"><input type="checkbox" id="e-saveclient"' + (isSavedClient(doc.client) ? ' checked' : '') + '> ' + esc(t('saveClient')) + '</label>' +
      '</section>' +

      '<section class="panel">' +
        '<h3>' + esc(t(isInv ? 'invoice' : 'quote')) + ' <span class="muted">' + esc(doc.number) + '</span></h3>' +
        '<div class="grid2">' +
          '<label class="fld"><span>' + esc(t('issueDate')) + '</span><input type="date" id="e-issue" class="input" value="' + esc(doc.issueDate) + '"></label>' +
          '<label class="fld"><span>' + esc(t(isInv ? 'dueDate' : 'validUntil')) + '</span><input type="date" id="e-due" class="input" value="' + esc(doc.dueDate) + '"></label>' +
        '</div>' +
        '<div class="grid2">' +
          '<label class="fld"><span>' + esc(t('status')) + '</span><select id="e-status" class="input">' +
            statuses.map(function (st) { return opt(st, t(st), doc.status); }).join('') + '</select></label>' +
          '<label class="fld"><span>' + esc(t('docLanguage')) + '</span><select id="e-lang" class="input">' +
            opt('ar', t('arabic'), doc.language) + opt('en', t('english'), doc.language) + '</select></label>' +
        '</div>' +
      '</section>' +

      '<section class="panel">' +
        '<h3>' + esc(t('items')) + '</h3>' +
        '<div class="items-head"><span>' + esc(t('description')) + '</span><span class="num">' + esc(t('qty')) + '</span><span class="num">' + esc(t('price')) + '</span><span class="num">' + esc(t('amount')) + '</span><span></span></div>' +
        '<div id="e-items">' + doc.items.map(itemRow).join('') + '</div>' +
        '<button class="btn soft" id="e-additem">+ ' + esc(t('addItem')) + '</button>' +
      '</section>' +

      '<section class="panel">' +
        '<div class="grid2">' +
          '<label class="fld"><span>' + esc(t('discount')) + '</span><select id="e-disctype" class="input">' +
            opt('none', t('discountNone'), doc.discountType) +
            opt('percent', t('discountPercent'), doc.discountType) +
            opt('fixed', t('discountFixed'), doc.discountType) + '</select></label>' +
          '<label class="fld"><span>' + esc(t('discount')) + '</span><input type="number" min="0" step="any" inputmode="decimal" id="e-discval" class="input" value="' + esc(doc.discountValue) + '"' + (doc.discountType === 'none' ? ' disabled' : '') + '></label>' +
        '</div>' +
        '<div class="grid2">' +
          '<label class="fld"><span>' + esc(t('taxRate')) + '</span><input type="number" min="0" step="any" inputmode="decimal" id="e-tax" class="input" value="' + esc(doc.taxRate) + '"></label>' +
          (isInv ? '<label class="fld"><span>' + esc(t('amountPaid')) + '</span><input type="number" min="0" step="any" inputmode="decimal" id="e-paid" class="input" value="' + esc(doc.amountPaid) + '"></label>' : '<span></span>') +
        '</div>' +
        '<label class="fld"><span>' + esc(t('notes')) + '</span><textarea id="e-notes" class="input" rows="3" placeholder="' + esc(t('notesPlaceholder')) + '">' + esc(doc.notes) + '</textarea></label>' +
      '</section>' +
      '</div>';

    var preview = '<div class="editor-preview' + (ui.editorTab === 'preview' ? ' active' : '') + '"><div id="sheet-wrap" class="sheet-wrap">' + renderSheet(doc) + '</div></div>';

    var actions =
      '<div class="editor-actions">' +
        '<button class="btn primary" id="e-pdf">' + esc(t('downloadPdf')) + '</button>' +
        '<button class="btn soft" id="e-print">' + esc(t('print')) + '</button>' +
        (doc.type === 'quote' ? '<button class="btn soft" id="e-convert">' + esc(t('convertToInvoice')) + '</button>' : '') +
        '<button class="btn ghost" id="e-dup">' + esc(t('duplicate')) + '</button>' +
        '<button class="btn ghost danger" id="e-del">' + esc(t('deleteDoc')) + '</button>' +
      '</div>';

    return renderShell(
      '<div class="editor-head">' +
        '<a class="btn ghost" href="#/">← ' + esc(t('back')) + '</a>' +
        '<h2>' + esc(t(doc.type)) + ' ' + esc(doc.number) + '</h2>' +
        '<span id="save-indicator" class="muted small"></span>' +
      '</div>' +
      '<div class="tabbar"><button class="tab' + (ui.editorTab === 'edit' ? ' on' : '') + '" data-tab="edit">' + esc(t('editTab')) + '</button>' +
      '<button class="tab' + (ui.editorTab === 'preview' ? ' on' : '') + '" data-tab="preview">' + esc(t('previewTab')) + '</button></div>' +
      '<div class="editor-grid">' + form + preview + '</div>' + actions
    );
  }

  function isSavedClient(client) {
    return state.clients.some(function (c) { return c.name === client.name && c.name; });
  }

  function itemRow(it) {
    return '<div class="item-row" data-item="' + esc(it.id) + '">' +
      '<input class="input i-desc" value="' + esc(it.description) + '" placeholder="' + esc(t('itemPlaceholder')) + '">' +
      '<input class="input i-qty num" type="number" min="0" step="any" inputmode="decimal" value="' + esc(it.qty) + '">' +
      '<input class="input i-price num" type="number" min="0" step="any" inputmode="decimal" value="' + esc(it.price) + '">' +
      '<span class="i-amt num">' + esc(money(Core.lineTotal(it))) + '</span>' +
      '<button class="mini danger i-del" title="' + esc(t('removeItem')) + '">✕</button>' +
    '</div>';
  }

  /* ---------- sheet (preview / print / pdf) ---------- */
  function renderSheet(doc, fixedWidth) {
    var s = state.settings;
    var L = doc.language === 'en' ? 'en' : 'ar';
    var tt = function (k) { return I18N.t(L, k); };
    var tot = docTotals(doc);
    var st = effectiveStatus(doc);
    var isInv = doc.type === 'invoice';
    var balance = Core.round2(Math.max(0, tot.total - Core.toNumber(doc.amountPaid)));

    var logoBlock = s.logo
      ? '<img class="sheet-logo" src="' + esc(s.logo) + '" alt="">'
      : '<div class="sheet-logo-fallback">' + esc((s.businessName || t('appName')).trim().charAt(0) || 'ف') + '</div>';

    var rows = doc.items.map(function (it, i) {
      return '<tr>' +
        '<td class="c-idx">' + (i + 1) + '</td>' +
        '<td class="c-desc">' + esc(it.description) + '</td>' +
        '<td class="c-num">' + esc(Core.toNumber(it.qty)) + '</td>' +
        '<td class="c-num">' + esc(docMoney(it.price, doc)) + '</td>' +
        '<td class="c-num">' + esc(docMoney(Core.lineTotal(it), doc)) + '</td>' +
      '</tr>';
    }).join('');

    return '<div class="sheet ' + (L === 'ar' ? 'rtl' : 'ltr') + '"' + (fixedWidth ? ' style="width:' + fixedWidth + 'px"' : '') + '>' +
      '<div class="sheet-accent"></div>' +
      '<div class="sheet-head">' +
        '<div class="sheet-brand">' + logoBlock +
          '<div><h1>' + esc(s.businessName || tt('appName')) + '</h1>' +
          (s.tagline ? '<p class="sheet-tag">' + esc(s.tagline) + '</p>' : '') +
          '<p class="sheet-contact">' + esc([s.phone, s.email, s.address].filter(Boolean).join(' · ')) + '</p></div>' +
        '</div>' +
        '<div class="sheet-meta">' +
          '<h2>' + esc(tt(doc.type)) + '</h2>' +
          '<p class="sheet-num">' + esc(doc.number) + '</p>' +
          '<span class="pill st-' + esc(st) + '">' + esc(tt(st)) + '</span>' +
        '</div>' +
      '</div>' +

      '<div class="sheet-dates">' +
        '<div><span>' + esc(tt('issueDate')) + '</span><strong>' + esc(Core.formatDate(doc.issueDate, L)) + '</strong></div>' +
        '<div><span>' + esc(tt(isInv ? 'dueDate' : 'validUntil')) + '</span><strong>' + esc(Core.formatDate(doc.dueDate, L)) + '</strong></div>' +
      '</div>' +

      '<div class="sheet-to">' +
        '<span class="sheet-to-label">' + esc(tt(isInv ? 'billTo' : 'quoteFor')) + '</span>' +
        '<strong>' + esc(doc.client.name) + '</strong>' +
        (doc.client.phone ? '<p>' + esc(doc.client.phone) + '</p>' : '') +
        (doc.client.email ? '<p>' + esc(doc.client.email) + '</p>' : '') +
        (doc.client.address ? '<p>' + esc(doc.client.address) + '</p>' : '') +
      '</div>' +

      '<table class="sheet-table">' +
        '<thead><tr><th class="c-idx">#</th><th>' + esc(tt('description')) + '</th><th class="c-num">' + esc(tt('qty')) + '</th><th class="c-num">' + esc(tt('price')) + '</th><th class="c-num">' + esc(tt('amount')) + '</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +

      '<div class="sheet-bottom">' +
        '<div class="sheet-notes">' +
          (doc.notes ? '<div class="note"><h4>' + esc(tt('notes')) + '</h4><p>' + esc(doc.notes).replace(/\n/g, '<br>') + '</p></div>' : '') +
          (s.terms ? '<div class="note"><h4>' + esc(tt('paymentTerms')) + '</h4><p>' + esc(s.terms).replace(/\n/g, '<br>') + '</p></div>' : '') +
        '</div>' +
        '<div class="sheet-totals">' +
          '<div><span>' + esc(tt('subtotal')) + '</span><span>' + esc(docMoney(tot.subtotal, doc)) + '</span></div>' +
          (tot.discount ? '<div><span>' + esc(tt('discount')) + '</span><span>−' + esc(docMoney(tot.discount, doc)) + '</span></div>' : '') +
          '<div><span>' + esc(tt('tax')) + ' (' + esc(Core.toNumber(doc.taxRate)) + '%)</span><span>' + esc(docMoney(tot.tax, doc)) + '</span></div>' +
          '<div class="grand"><span>' + esc(tt('total')) + '</span><span>' + esc(docMoney(tot.total, doc)) + '</span></div>' +
          (isInv && Core.toNumber(doc.amountPaid) > 0 ?
            '<div><span>' + esc(tt('amountPaid')) + '</span><span>' + esc(docMoney(doc.amountPaid, doc)) + '</span></div>' +
            '<div class="balance"><span>' + esc(tt('balanceDue')) + '</span><span>' + esc(docMoney(balance, doc)) + '</span></div>' : '') +
        '</div>' +
      '</div>' +

      '<div class="sheet-foot">' + esc(s.footer || tt('thankYou')) + '</div>' +
    '</div>';
  }

  /* ---------- settings ---------- */
  function renderSettings() {
    var s = state.settings;
    var curOpts = Core.CURRENCIES.map(function (c) { return opt(c, c, s.currency); }).join('');

    var content =
      '<div class="editor-head"><a class="btn ghost" href="#/">← ' + esc(t('back')) + '</a><h2>' + esc(t('settingsTitle')) + '</h2></div>' +

      '<section class="panel hint"><p>' + esc(t('whiteLabelHint')) + '</p></section>' +

      '<section class="panel"><h3>' + esc(t('branding')) + '</h3>' +
        '<label class="fld"><span>' + esc(t('businessName')) + '</span><input id="s-name" class="input" value="' + esc(s.businessName) + '" placeholder="' + esc(t('businessNamePlaceholder')) + '"></label>' +
        '<label class="fld"><span>' + esc(t('businessTagline')) + '</span><input id="s-tagline" class="input" value="' + esc(s.tagline) + '" placeholder="' + esc(t('taglinePlaceholder')) + '"></label>' +
        '<div class="grid2">' +
          '<label class="fld"><span>' + esc(t('phone')) + '</span><input id="s-phone" class="input" dir="ltr" value="' + esc(s.phone) + '"></label>' +
          '<label class="fld"><span>' + esc(t('email')) + '</span><input id="s-email" class="input" dir="ltr" value="' + esc(s.email) + '"></label>' +
        '</div>' +
        '<label class="fld"><span>' + esc(t('address')) + '</span><input id="s-addr" class="input" value="' + esc(s.address) + '"></label>' +
        '<div class="logo-row">' +
          '<div class="logo-preview">' + (s.logo ? '<img src="' + esc(s.logo) + '" alt="logo">' : '<span>' + esc((s.businessName || 'ف').charAt(0)) + '</span>') + '</div>' +
          '<div>' +
            '<input type="file" id="s-logo" accept="image/*" hidden>' +
            '<button class="btn soft" id="s-logo-btn">' + esc(t('uploadLogo')) + '</button> ' +
            (s.logo ? '<button class="btn ghost danger" id="s-logo-del">' + esc(t('removeLogo')) + '</button>' : '') +
          '</div>' +
        '</div>' +
        '<div class="grid2">' +
          '<label class="fld"><span>' + esc(t('accentColor')) + '</span><input type="color" id="s-accent" class="input color" value="' + esc(s.accent) + '"></label>' +
          '<label class="fld"><span>' + esc(t('currency')) + '</span><select id="s-currency" class="input">' + curOpts + '</select></label>' +
        '</div>' +
        '<label class="fld"><span>' + esc(t('language')) + '</span><select id="s-lang" class="input">' +
          opt('ar', t('arabic'), s.language) + opt('en', t('english'), s.language) + '</select></label>' +
      '</section>' +

      '<section class="panel"><h3>' + esc(t('defaults')) + '</h3>' +
        '<div class="grid2">' +
          '<label class="fld"><span>' + esc(t('defaultTax')) + '</span><input type="number" min="0" step="any" id="s-tax" class="input" value="' + esc(s.taxRate) + '"></label>' +
          '<label class="fld"><span>' + esc(t('dueAfter')) + '</span><input type="number" min="0" id="s-due" class="input" value="' + esc(s.dueDays) + '"></label>' +
        '</div>' +
        '<div class="grid2">' +
          '<label class="fld"><span>' + esc(t('invoicePrefix')) + '</span><input id="s-invprefix" class="input" dir="ltr" value="' + esc(s.invoicePrefix) + '"></label>' +
          '<label class="fld"><span>' + esc(t('nextInvoiceNo')) + '</span><input type="number" min="1" id="s-invseq" class="input" value="' + esc(s.invoiceSeq) + '"></label>' +
        '</div>' +
        '<div class="grid2">' +
          '<label class="fld"><span>' + esc(t('quotePrefix')) + '</span><input id="s-qteprefix" class="input" dir="ltr" value="' + esc(s.quotePrefix) + '"></label>' +
          '<label class="fld"><span>' + esc(t('nextQuoteNo')) + '</span><input type="number" min="1" id="s-qteseq" class="input" value="' + esc(s.quoteSeq) + '"></label>' +
        '</div>' +
        '<label class="fld"><span>' + esc(t('termsLabel')) + '</span><textarea id="s-terms" class="input" rows="3" placeholder="' + esc(t('termsPlaceholder')) + '">' + esc(s.terms) + '</textarea></label>' +
        '<label class="fld"><span>' + esc(t('footerLabel')) + '</span><input id="s-footer" class="input" value="' + esc(s.footer) + '" placeholder="' + esc(t('footerPlaceholder')) + '"></label>' +
      '</section>' +

      '<section class="panel"><h3>' + esc(t('data')) + '</h3>' +
        '<div class="btnrow">' +
          '<button class="btn soft" id="s-exp-settings">' + esc(t('exportSettings')) + '</button>' +
          '<button class="btn soft" id="s-imp-settings">' + esc(t('importSettings')) + '</button>' +
        '</div>' +
        '<div class="btnrow">' +
          '<button class="btn soft" id="s-exp-backup">' + esc(t('exportBackup')) + '</button>' +
          '<button class="btn soft" id="s-imp-backup">' + esc(t('importBackup')) + '</button>' +
          '<button class="btn soft" id="s-exp-csv">' + esc(t('exportCsv')) + '</button>' +
        '</div>' +
        '<input type="file" id="s-import-file" accept="application/json,.json" hidden>' +
        '<div class="btnrow"><button class="btn ghost danger" id="s-reset">' + esc(t('resetAll')) + '</button></div>' +
      '</section>';

    return renderShell(content);
  }

  /* ---------- render + bind ---------- */
  function render() {
    var s = state.settings;
    document.documentElement.lang = uiLang();
    document.documentElement.dir = I18N.dir(uiLang());
    document.title = (s.businessName ? s.businessName + ' · ' : '') + t('appName');
    document.documentElement.style.setProperty('--accent', s.accent);
    document.documentElement.style.setProperty('--accent-soft', s.accent + '1f');

    var app = $('#app');
    if (ui.route.view === 'new') {
      var fresh = createDoc(ui.route.type);
      ui.route = { view: 'editor', id: fresh.id };
      try { window.history.replaceState(null, '', '#/edit/' + fresh.id); } catch (e) { /* jsdom quirk */ }
      app.innerHTML = renderEditor(fresh.id); bindEditor();
    }
    else if (ui.route.view === 'editor') app.innerHTML = renderEditor(ui.route.id) , bindEditor();
    else if (ui.route.view === 'settings') app.innerHTML = renderSettings(), bindSettings();
    else app.innerHTML = renderDashboard(), bindDashboard();
    bindShell();
  }

  function bindShell() {
    var lt = $('#lang-toggle');
    if (lt) lt.onclick = function () {
      state.settings.language = uiLang() === 'ar' ? 'en' : 'ar';
      persist();
      render();
    };
  }

  function bindDashboard() {
    var q = $('#f-q');
    if (q) q.oninput = function () { ui.filter.q = q.value; refreshList(); };
    var ft = $('#f-type');
    if (ft) ft.onchange = function () { ui.filter.type = ft.value; ui.filter.status = 'all'; render(); };
    var fs = $('#f-status');
    if (fs) fs.onchange = function () { ui.filter.status = fs.value; refreshList(); };
    $all('.doccard .mini').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.closest('.doccard').dataset.id;
        var act = btn.dataset.act;
        if (act === 'pdf') exportPdf(findDoc(id));
        else if (act === 'dup') duplicateDoc(id);
        else if (act === 'del') deleteDoc(id);
      };
    });
  }

  function refreshList() {
    var listEl = $('.doclist');
    var docs = filteredDocs();
    if (!listEl) { render(); return; }
    listEl.innerHTML = docs.length ? docs.map(docCard).join('') : '<section class="empty small"><p>' + esc(t('noResults')) + '</p></section>';
    bindDashboard();
    var q = $('#f-q');
    if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  function bindEditor() {
    var doc = findDoc(ui.editingId);
    if (!doc) return;

    $all('.tab').forEach(function (tab) {
      tab.onclick = function () {
        ui.editorTab = tab.dataset.tab;
        $all('.tab').forEach(function (x) { x.classList.toggle('on', x === tab); });
        $('.editor-form').classList.toggle('active', ui.editorTab === 'edit');
        $('.editor-preview').classList.toggle('active', ui.editorTab === 'preview');
      };
    });

    function syncFromForm() {
      doc.client.name = $('#e-cname').value;
      doc.client.phone = $('#e-cphone').value;
      doc.client.email = $('#e-cemail').value;
      doc.client.address = $('#e-caddr').value;
      doc.issueDate = $('#e-issue').value || doc.issueDate;
      doc.dueDate = $('#e-due').value || doc.dueDate;
      doc.status = $('#e-status').value;
      doc.language = $('#e-lang').value;
      doc.discountType = $('#e-disctype').value;
      doc.discountValue = Core.toNumber($('#e-discval').value);
      doc.taxRate = Core.toNumber($('#e-tax').value);
      var paid = $('#e-paid');
      if (paid) doc.amountPaid = Core.toNumber(paid.value);
      doc.notes = $('#e-notes').value;
      $all('#e-items .item-row').forEach(function (row) {
        var it = null;
        doc.items.forEach(function (x) { if (x.id === row.dataset.item) it = x; });
        if (it) {
          it.description = $('.i-desc', row).value;
          it.qty = Core.toNumber($('.i-qty', row).value);
          it.price = Core.toNumber($('.i-price', row).value);
        }
      });
      doc.updatedAt = new Date().toISOString();

      // save-client checkbox
      var saveC = $('#e-saveclient');
      if (saveC && saveC.checked && doc.client.name.trim() && !isSavedClient(doc.client)) {
        var nc = Core.newClient();
        nc.name = doc.client.name; nc.phone = doc.client.phone; nc.email = doc.client.email; nc.address = doc.client.address;
        state.clients.push(nc);
      }
      scheduleSave();
      refreshPreview();
    }

    function refreshPreview() {
      var wrap = $('#sheet-wrap');
      if (wrap) wrap.innerHTML = renderSheet(doc);
      // live line totals
      $all('#e-items .item-row').forEach(function (row) {
        var it = null;
        doc.items.forEach(function (x) { if (x.id === row.dataset.item) it = x; });
        if (it) $('.i-amt', row).textContent = money(Core.lineTotal(it));
      });
    }

    $all('.editor-form input, .editor-form textarea, .editor-form select').forEach(function (el) {
      if (el.id === 'e-client-pick') return;
      el.addEventListener('input', syncFromForm);
      el.addEventListener('change', syncFromForm);
    });

    var pick = $('#e-client-pick');
    if (pick) pick.onchange = function () {
      var c = null;
      state.clients.forEach(function (x) { if (x.id === pick.value) c = x; });
      if (c) {
        doc.client = { id: doc.client.id, name: c.name, phone: c.phone, email: c.email, address: c.address };
        $('#e-cname').value = c.name; $('#e-cphone').value = c.phone;
        $('#e-cemail').value = c.email; $('#e-caddr').value = c.address;
        syncFromForm();
      }
    };

    $('#e-disctype').addEventListener('change', function () {
      $('#e-discval').disabled = $('#e-disctype').value === 'none';
    });

    // Marking an invoice as paid fills the paid amount with the current total.
    $('#e-status').addEventListener('change', function () {
      var paidEl = $('#e-paid');
      if (paidEl && $('#e-status').value === 'paid' && Core.toNumber(paidEl.value) === 0) {
        syncFromForm();
        paidEl.value = docTotals(doc).total;
        syncFromForm();
      }
    });

    $('#e-additem').onclick = function () {
      doc.items.push(Core.newItem());
      var box = $('#e-items');
      box.insertAdjacentHTML('beforeend', itemRow(doc.items[doc.items.length - 1]));
      bindItemRow(box.lastElementChild);
      syncFromForm();
      $('.i-desc', box.lastElementChild).focus();
    };

    function bindItemRow(row) {
      $all('input', row).forEach(function (inp) {
        inp.addEventListener('input', syncFromForm);
      });
      $('.i-del', row).onclick = function () {
        if (doc.items.length <= 1) return;
        doc.items = doc.items.filter(function (x) { return x.id !== row.dataset.item; });
        row.remove();
        syncFromForm();
      };
    }
    $all('#e-items .item-row').forEach(bindItemRow);

    $('#e-pdf').onclick = function () { exportPdf(doc); };
    $('#e-print').onclick = function () { printDoc(doc); };
    var conv = $('#e-convert');
    if (conv) conv.onclick = function () { convertToInvoice(doc.id); };
    $('#e-dup').onclick = function () { duplicateDoc(doc.id); };
    $('#e-del').onclick = function () { deleteDoc(doc.id); };
  }

  /* ---------- pdf & print ---------- */
  function exportPdf(doc) {
    if (!doc) return;
    var errs = Core.validateDoc(doc);
    if (errs.length) {
      toast(errs.indexOf('clientName') >= 0 ? t('errClientName') : t('errItems'));
      if (ui.route.view !== 'editor') go('#/edit/' + doc.id);
      return;
    }
    toast(t('pdfPreparing'));
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;';
    host.innerHTML = renderSheet(doc, 794);
    document.body.appendChild(host);
    var sheetEl = host.firstElementChild;
    setTimeout(function () {
      html2canvas(sheetEl, { scale: 2, useCORS: true, backgroundColor: '#ffffff' }).then(function (canvas) {
        var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        var pageW = 210, pageH = 297;
        var pxPerMm = canvas.width / pageW;
        var pageCanvasH = Math.floor(pageH * pxPerMm);
        var y = 0, page = 0;
        while (y < canvas.height) {
          var sliceH = Math.min(pageCanvasH, canvas.height - y);
          var pc = document.createElement('canvas');
          pc.width = canvas.width; pc.height = sliceH;
          var ctx = pc.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, pc.width, pc.height);
          ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
          var img = pc.toDataURL('image/jpeg', 0.95);
          if (page > 0) pdf.addPage();
          pdf.addImage(img, 'JPEG', 0, 0, pageW, sliceH / pxPerMm);
          y += sliceH;
          page++;
        }
        pdf.save(doc.number + '.pdf');
        document.body.removeChild(host);
        toast(t('pdfDone'));
      }).catch(function () {
        document.body.removeChild(host);
        printDoc(doc);
      });
    }, 60);
  }

  function printDoc(doc) {
    var area = $('#print-area');
    area.innerHTML = renderSheet(doc);
    document.body.classList.add('printing');
    setTimeout(function () {
      window.print();
      document.body.classList.remove('printing');
    }, 60);
  }

  /* ---------- settings bindings ---------- */
  function bindSettings() {
    var s = state.settings;

    function sync() {
      s.businessName = $('#s-name').value;
      s.tagline = $('#s-tagline').value;
      s.phone = $('#s-phone').value;
      s.email = $('#s-email').value;
      s.address = $('#s-addr').value;
      s.accent = $('#s-accent').value;
      s.currency = $('#s-currency').value;
      s.taxRate = Core.toNumber($('#s-tax').value);
      s.dueDays = Math.max(0, Math.floor(Core.toNumber($('#s-due').value)));
      s.invoicePrefix = $('#s-invprefix').value;
      s.invoiceSeq = Math.max(1, Math.floor(Core.toNumber($('#s-invseq').value, 1)));
      s.quotePrefix = $('#s-qteprefix').value;
      s.quoteSeq = Math.max(1, Math.floor(Core.toNumber($('#s-qteseq').value, 1)));
      s.terms = $('#s-terms').value;
      s.footer = $('#s-footer').value;
      persist();
      document.documentElement.style.setProperty('--accent', s.accent);
      document.documentElement.style.setProperty('--accent-soft', s.accent + '1f');
    }

    $all('.panel input, .panel select, .panel textarea').forEach(function (el) {
      if (el.type === 'file') return;
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    });

    $('#s-lang').addEventListener('change', function () {
      s.language = $('#s-lang').value;
      persist();
      render();
    });

    $('#s-logo-btn').onclick = function () { $('#s-logo').click(); };
    $('#s-logo').onchange = function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var max = 240;
          var scale = Math.min(1, max / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          s.logo = c.toDataURL('image/png');
          persist();
          render();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    };
    var logoDel = $('#s-logo-del');
    if (logoDel) logoDel.onclick = function () { s.logo = ''; persist(); render(); };

    function download(name, obj) {
      var blob = new Blob([Core.serialize(obj)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }

    function importFile(kind) {
      var input = $('#s-import-file');
      input.onchange = function (e) {
        var file = e.target.files && e.target.files[0];
        input.value = '';
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          var data = null;
          try { data = JSON.parse(reader.result); } catch (err) { data = null; }
          var clean = Core.sanitizeImported(data, kind);
          if (!clean) { toast(t('importBad')); return; }
          if (kind === 'settings') { state.settings = clean; }
          else { state.settings = clean.settings; state.docs = clean.docs; state.clients = clean.clients; }
          persist();
          toast(t('importOk'));
          render();
        };
        reader.readAsText(file);
      };
      input.click();
    }

    $('#s-exp-settings').onclick = function () { download('fatora-settings.json', state.settings); };
    $('#s-exp-backup').onclick = function () { download('fatora-backup.json', state); };
    $('#s-exp-csv').onclick = function () {
      var blob = new Blob([Core.toCsv(state.docs, state.settings.currency)], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'fatora-documents.csv';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    };
    $('#s-imp-settings').onclick = function () { importFile('settings'); };
    $('#s-imp-backup').onclick = function () { importFile('backup'); };
    $('#s-reset').onclick = function () {
      if (!confirm(t('confirmReset'))) return;
      state = { settings: Core.defaultSettings(), docs: [], clients: [] };
      Store.wipe();
      persist();
      render();
    };
  }

  /* ---------- boot ---------- */
  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/';
  route();
})();
