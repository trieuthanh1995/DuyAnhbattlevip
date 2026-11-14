/* Bubble Blast – điều khiển
 * Máy tính: WASD đi · chuột ngắm · bấm chuột/Space bắn · Q hoặc chuột phải đổi súng (1 = súng bong bóng, 2 = ná)
 *           mũi tên = ngắm + bắn kiểu 2 cần (không cần chuột)
 * Cảm ứng : cần trái = đi, cần phải = ngắm (giữ cần là bắn), nút 🔁 đổi súng
 * Tay cầm : cần trái đi, cần phải ngắm, RT/RB bắn, Y/LB đổi súng */
(function (PP) {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const keys = new Set();
  const S = {
    active: false, touch: false,
    mouse: { px: 0, py: 0, on: false, down: false },
    move: { x: 0, y: 0 }, aimStick: null, fire: false, swap: 0, pick: null,
    stickL: null, stickR: null, pad: false,
  };
  const R = 62;   // bán kính cần ảo (px)

  function typing(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA'); }
  function onKey(e, down) {
    if (!S.active || typing(e)) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (down) {
      if (k === 'q' || k === 'Tab' || k === 'e') { if (!e.repeat) S.swap++; e.preventDefault(); return; }
      if (k === '1') { S.pick = 'rifle'; return; }
      if (k === '2') { S.pick = 'sniper'; return; }
      if (' ArrowUp ArrowDown ArrowLeft ArrowRight'.includes(k)) e.preventDefault();
      keys.add(k);
    } else keys.delete(k);
  }
  /** Cần ảo cảm ứng: chạm là hiện đúng chỗ ngón tay, thả là ẩn */
  function bindStick(zoneSel, padSel, knobSel, which) {
    const zone = $(zoneSel), pad = $(padSel), knob = $(knobSel);
    if (!zone) return;
    let id = null, ox = 0, oy = 0;
    zone.addEventListener('pointerdown', (e) => {
      if (!S.active || id !== null) return;
      id = e.pointerId; ox = e.clientX; oy = e.clientY; S.touch = true;
      try { zone.setPointerCapture(id); } catch (x) { /* bỏ qua */ }
      pad.style.left = ox + 'px'; pad.style.top = oy + 'px'; pad.classList.add('show');
      S[which] = { x: 0, y: 0 }; knob.style.transform = 'translate(0,0)';
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - ox, dy = e.clientY - oy; const l = Math.hypot(dx, dy);
      if (l > R) { dx = dx / l * R; dy = dy / l * R; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      S[which] = { x: dx / R, y: -dy / R };      // y hướng lên
    });
    const end = (e) => { if (e.pointerId !== id) return; id = null; S[which] = null; pad.classList.remove('show'); knob.style.transform = 'translate(0,0)'; };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  }
  function init(canvas) {
    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));
    window.addEventListener('blur', () => { keys.clear(); S.mouse.down = false; });
    canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { S.mouse.px = e.clientX; S.mouse.py = e.clientY; S.mouse.on = true; } });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || !S.active) return;
      S.mouse.px = e.clientX; S.mouse.py = e.clientY; S.mouse.on = true;
      if (e.button === 2) S.swap++; else S.mouse.down = true;
    });
    window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' && e.button !== 2) S.mouse.down = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    bindStick('#joy-zone', '#joy', '#joy-knob', 'stickL');
    bindStick('#aim-zone', '#aim', '#aim-knob', 'stickR');
    const sw = $('#btn-swap');
    if (sw) sw.addEventListener('pointerdown', (e) => { if (!S.active) return; S.swap++; S.touch = true; e.preventDefault(); });
  }
  let padSwap = false;
  /** Gọi mỗi khung hình: trả về trạng thái điều khiển hiện tại */
  function poll() {
    const o = { mx: 0, my: 0, aimScreen: null, aimMouse: null, fire: false, swap: S.swap, pick: S.pick, touch: S.touch };
    S.swap = 0; S.pick = null;
    // di chuyển
    let mx = 0, my = 0;
    if (keys.has('a')) mx -= 1; if (keys.has('d')) mx += 1;
    if (keys.has('w')) my += 1; if (keys.has('s')) my -= 1;
    if (S.stickL) { mx += S.stickL.x; my += S.stickL.y; }
    // tay cầm
    let gp = null;
    try { const pads = navigator.getGamepads ? navigator.getGamepads() : []; for (const p of pads) if (p && p.connected) { gp = p; break; } } catch (e) { gp = null; }
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.2 ? 0 : v);
      mx += dz(gp.axes[0] || 0); my -= dz(gp.axes[1] || 0);
      const ax = dz(gp.axes[2] || 0), ay = dz(gp.axes[3] || 0);
      if (ax || ay) { o.aimScreen = { x: ax, y: -ay }; o.fire = true; }
      if ((gp.buttons[7] && gp.buttons[7].pressed) || (gp.buttons[5] && gp.buttons[5].pressed)) o.fire = true;
      const sw = (gp.buttons[3] && gp.buttons[3].pressed) || (gp.buttons[4] && gp.buttons[4].pressed);
      if (sw && !padSwap) o.swap++;
      padSwap = !!sw;
    }
    const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
    o.mx = mx; o.my = my;
    // ngắm: cần phải > mũi tên > chuột
    if (S.stickR && Math.hypot(S.stickR.x, S.stickR.y) > 0.22) { o.aimScreen = { x: S.stickR.x, y: S.stickR.y }; o.fire = true; }
    let ax = 0, ay = 0;
    if (keys.has('ArrowLeft')) ax -= 1; if (keys.has('ArrowRight')) ax += 1;
    if (keys.has('ArrowUp')) ay += 1; if (keys.has('ArrowDown')) ay -= 1;
    if (ax || ay) { o.aimScreen = { x: ax, y: ay }; o.fire = true; }
    else if (!o.aimScreen && S.mouse.on && !S.touch) o.aimMouse = { px: S.mouse.px, py: S.mouse.py };
    if (S.mouse.down || keys.has(' ') || keys.has('j')) o.fire = true;
    return o;
  }
  function setActive(on) {
    S.active = !!on;
    if (!on) { keys.clear(); S.mouse.down = false; S.stickL = S.stickR = null; document.querySelectorAll('#joy,#aim').forEach((e) => e.classList.remove('show')); }
  }
  function isTouch() { return S.touch || !!(window.matchMedia && matchMedia('(pointer: coarse)').matches); }
  PP.Input = { init, poll, setActive, isTouch, state: S };
})(window.PP);
