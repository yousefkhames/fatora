/* Fatora store — localStorage persistence with a versioned envelope. */
(function (root) {
  'use strict';
  var Core = root.FatoraCore;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(Core.STORAGE_KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        var clean = Core.sanitizeImported(parsed, 'backup');
        if (clean) return clean;
      } catch (e) { /* fall through to fresh state */ }
    }
    return { settings: Core.defaultSettings(), docs: [], clients: [] };
  }

  function save(state) {
    try {
      localStorage.setItem(Core.STORAGE_KEY, Core.serialize(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  function wipe() {
    try { localStorage.removeItem(Core.STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  root.FatoraStore = { load: load, save: save, wipe: wipe };
})(typeof self !== 'undefined' ? self : this);
