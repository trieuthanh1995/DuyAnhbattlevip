/* Bubble Blast – giao thức online (JSON qua WebSocket) + kiểm tra dữ liệu */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const cfg = isNode ? require('./config.js') : root.PP;
  const mod = factory(cfg);
  if (isNode) module.exports = mod;
  else { root.PP = root.PP || {}; Object.assign(root.PP, mod); }
})(typeof self !== 'undefined' ? self : this, function (cfg) {
  'use strict';
  const PROTOCOL_VERSION = 1;
  const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const MODES = ['1v1', '2v2'];
  const BOS = [1, 3];
  const WEAPONS = ['rifle', 'sniper'];
  const LEVEL_IDS = Object.keys(cfg.LEVELS);
  const VENUE_IDS = cfg.MAPS.map((v) => v.id);
  const CHAR_IDS = cfg.CHARACTERS.map((c) => c.id);
  const LOOK = cfg.LOOK;
  const HEX_RE = /^#[0-9a-f]{6}$/i;

  const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  const isStr = (v, max, min) => typeof v === 'string' && v.length <= max && v.length >= (min || 0);
  const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const lookOk = (l) => {
    if (l === undefined) return true;
    if (!isObj(l)) return false;
    const keys = Object.keys(l);
    if (keys.length > 16) return false;
    for (const k of keys) {
      const v = l[k];
      if (k.length > 24) return false;
      if (typeof v === 'string' ? v.length > 24 : !(typeof v === 'number' || typeof v === 'boolean' || v === null)) return false;
    }
    return true;
  };
  const settingsOk = (s) => isObj(s) && VENUE_IDS.includes(s.venue) && BOS.includes(s.bo);

  const V = {
    hello: (m) => isStr(m.deviceId, 64, 8) && isStr(m.name, 40, 1) && CHAR_IDS.includes(m.char) && isInt(m.version, 0, 1e6) && lookOk(m.look),
    ping: (m) => isNum(m.c, 0, 1e12),
    queue_join: (m) => MODES.includes(m.mode),
    queue_leave: () => true,
    room_create: (m) => MODES.includes(m.mode) && settingsOk(m.settings),
    room_join: (m) => isStr(m.code, 4, 4),
    room_leave: () => true,
    room_update: (m) => (m.settings === undefined || settingsOk(m.settings)) &&
      (m.team === undefined || m.team === 'A' || m.team === 'B') &&
      (m.fillBots === undefined || typeof m.fillBots === 'boolean') &&
      (m.botLevel === undefined || LEVEL_IDS.includes(m.botLevel)),
    room_ready: (m) => typeof m.ready === 'boolean',
    room_start: () => true,
    chat: (m) => isStr(m.text, 200, 1),
    // trạng thái người chơi: vị trí, vận tốc, hướng ngắm, đang bóp cò, súng đang chọn
    input: (m) => isNum(m.x, -30, 30) && isNum(m.z, -30, 30) && isNum(m.vx, -20, 20) && isNum(m.vz, -20, 20) &&
      isNum(m.aim, -10, 10) && typeof m.fire === 'boolean' && WEAPONS.includes(m.w),
    rematch: () => true,
    spectate: (m) => isStr(m.code, 4, 4),
    spectate_leave: () => true,
    leaderboard: () => true,
    set_profile: (m) => isStr(m.name, 40, 1) && CHAR_IDS.includes(m.char) && lookOk(m.look),
  };
  function validate(m) {
    if (!isObj(m) || typeof m.t !== 'string') return false;
    const f = V[m.t];
    if (!f) return false;
    try { return f(m) === true; } catch (e) { return false; }
  }
  function cleanText(s, max) {
    return String(s).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }
  const cleanName = (s) => cleanText(s, 16);
  const cleanChat = (s) => cleanText(s, 120);
  function cleanLook(o) {
    const out = {};
    try {
      if (!isObj(o)) return out;
      const own = (k) => Object.prototype.hasOwnProperty.call(o, k);
      for (const k of LOOK.colorKeys) if (own(k) && typeof o[k] === 'string' && HEX_RE.test(o[k])) out[k] = o[k].toLowerCase();
      if (own('pattern') && LOOK.patterns.includes(o.pattern)) out.pattern = o.pattern;
      if (own('accessory') && LOOK.accessories.includes(o.accessory)) out.accessory = o.accessory;
      if (own('shirtStyle') && LOOK.shirtStyles.includes(o.shirtStyle)) out.shirtStyle = o.shirtStyle;
      if (own('number') && isInt(o.number, 0, LOOK.numberMax)) out.number = o.number;
    } catch (e) { return {}; }
    return out;
  }
  return { Protocol: { PROTOCOL_VERSION, ROOM_ALPHABET, MODES, BOS, validate, cleanName, cleanChat, cleanLook, lookOk, settingsOk } };
});
