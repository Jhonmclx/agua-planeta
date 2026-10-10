// Edición automática de fotos de ropa (todo ocurre en el celular/PC, antes de subir)
// - Corrige orientación, recorta a 3:4, ajusta niveles/blancos, luz, color y nitidez
// - Agrega el logo USA2 como marca de agua (opcional)
// - Permite ajustes manuales con sliders

export const DEFAULT_ADJ = { bg: "none", auto: true, brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpen: 35, rotate: 0, crop: "3:4", zoom: 1, offsetX: 0, offsetY: 0, watermark: true };

export async function loadBitmap(src) {
  // src: File/Blob o URL
  if (src instanceof Blob) {
    try { return await createImageBitmap(src, { imageOrientation: "from-image" }); }
    catch (e) { /* respaldo para navegadores viejos */ }
    const url = URL.createObjectURL(src);
    try { return await loadImg(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
  }
  return loadImg(src);
}
function loadImg(url) {
  return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = url; });
}

const clamp = (v, a = 0, b = 255) => (v < a ? a : v > b ? b : v);

// Analiza la imagen y calcula los parámetros automáticos
function analyze(data) {
  const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256), hl = new Uint32Array(256);
  const step = Math.max(1, Math.floor(data.length / 4 / 120000)) * 4;
  let n = 0;
  for (let i = 0; i < data.length; i += step) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    hr[r]++; hg[g]++; hb[b]++; hl[(r * 0.299 + g * 0.587 + b * 0.114) | 0]++; n++;
  }
  const pct = (h, p) => { let acc = 0; const t = n * p; for (let i = 0; i < 256; i++) { acc += h[i]; if (acc >= t) return i; } return 255; };
  const lo = [pct(hr, 0.005), pct(hg, 0.005), pct(hb, 0.005)];
  const hi = [pct(hr, 0.995), pct(hg, 0.995), pct(hb, 0.995)];
  const lLo = pct(hl, 0.005), lHi = pct(hl, 0.995);
  let sum = 0, dark = 0; for (let i = 0; i < 256; i++) { sum += hl[i] * i; if (i < 70) dark += hl[i]; }
  return { lo, hi, lLo, lHi, mean: sum / n / 255, darkFrac: dark / n };
}

function buildLUTs(stats, adj) {
  const luts = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
  const wb = 0.55; // cuánto corregir el balance de blancos por canal
  let gamma = 1;
  if (adj.auto && stats) {
    // brillo objetivo: fotos de ropa se ven mejor un poco claras
    const m = Math.min(0.95, Math.max(0.05, stats.mean));
    gamma = Math.log(0.54) / Math.log(m);
    gamma = Math.min(1.35, Math.max(0.72, gamma));
  }
  const bright = adj.brightness / 100; // -0.5..0.5
  const darkSubject = adj.auto && stats && stats.darkFrac > 0.12; // prenda oscura: no hundir las sombras
  const contrast = 1 + adj.contrast / 100 + (adj.auto && !darkSubject ? 0.06 : 0);
  const warm = adj.warmth / 100;
  for (let c = 0; c < 3; c++) {
    let lo = 0, hi = 255;
    if (adj.auto && stats) {
      lo = stats.lLo * (1 - wb) + stats.lo[c] * wb;
      hi = stats.lHi * (1 - wb) + stats.hi[c] * wb;
      lo = Math.min(lo, darkSubject ? 10 : 60); hi = Math.max(hi, 170);
      if (hi - lo < 40) { lo = 0; hi = 255; }
    }
    for (let i = 0; i < 256; i++) {
      let v = (i - lo) / (hi - lo);
      v = clamp(v, 0, 1);
      v = Math.pow(v, 1 / gamma);
      if (darkSubject) v = v + 0.75 * v * (1 - v) * (1 - v); // levanta sombras para ver el detalle
      v = (v - 0.5) * contrast + 0.5 + bright * 0.6;
      if (c === 0) v += warm * 0.08;
      if (c === 2) v -= warm * 0.08;
      luts[c][i] = clamp(Math.round(v * 255));
    }
  }
  return luts;
}

// Quita manchas de color en prendas oscuras (ruido de cámara con poca luz)
// sin tocar estampados, letras ni detalles de color.
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / k;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / k;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}
function cleanBlotches(img, w, h) {
  const d = img.data, n = w * h;
  const Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    Y[j] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[j] = -0.1687 * r - 0.3313 * g + 0.5 * b;
    Cr[j] = 0.5 * r - 0.4187 * g - 0.0813 * b;
  }
  const rad = Math.max(4, Math.round(Math.min(w, h) * 0.012));
  let bCb = boxBlur(Cb, w, h, rad), bCr = boxBlur(Cr, w, h, rad);
  bCb = boxBlur(bCb, w, h, rad); bCr = boxBlur(bCr, w, h, rad);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    let m = (115 - Y[j]) / 35; // solo zonas oscuras
    if (m <= 0) continue; if (m > 1) m = 1;
    const dev = Math.abs(Cb[j] - bCb[j]) + Math.abs(Cr[j] - bCr[j]);
    if (dev > 22) continue;            // detalle de color real (estampado)
    if (dev > 12) m *= (22 - dev) / 10;
    m *= 0.85;
    const cb = Cb[j] * (1 - m) + bCb[j] * m, cr = Cr[j] * (1 - m) + bCr[j] * m, y = Y[j];
    d[i] = y + 1.402 * cr;
    d[i + 1] = y - 0.34414 * cb - 0.71414 * cr;
    d[i + 2] = y + 1.772 * cb;
  }
}

function sharpen(img, w, h, amount) {
  if (amount <= 0) return;
  const a = amount / 100;
  const src = new Uint8ClampedArray(img.data);
  const d = img.data;
  const row = w * 4;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * row + x * 4;
      for (let c = 0; c < 3; c++) {
        const k = i + c;
        const blur = (src[k - 4] + src[k + 4] + src[k - row] + src[k + row]) * 0.25;
        d[k] = src[k] + (src[k] - blur) * a * 1.4;
      }
    }
  }
}

let logoReady = null;
async function ensureFont() {
  if (!logoReady) logoReady = new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = "/assets/logo.jpg"; });
  return logoReady;
}

function drawWatermark(ctx, w, h, logo) {
  if (!logo) return;
  const lw = Math.round(w * 0.26), lh = Math.round(lw * logo.height / logo.width);
  const m = Math.round(w * 0.035), x = w - lw - m, y = h - lh - m, r = lh * 0.14, b = Math.max(2, Math.round(lw * 0.018));
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = b * 3;
  ctx.fillStyle = "#fff"; roundRect(ctx, x - b, y - b, lw + b * 2, lh + b * 2, r + b); ctx.fill();
  ctx.shadowColor = "transparent";
  roundRect(ctx, x, y, lw, lh, r); ctx.clip();
  ctx.drawImage(logo, x, y, lw, lh);
  ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Dibuja la imagen editada en un canvas. maxSide controla la resolución final.
export async function render(bitmap, adj = DEFAULT_ADJ, maxSide = 1400) {
  const logo = await ensureFont();
  const rot = ((adj.rotate % 360) + 360) % 360;
  const sw0 = bitmap.width, sh0 = bitmap.height;
  const rw = rot % 180 ? sh0 : sw0, rh = rot % 180 ? sw0 : sh0; // tamaño ya rotado

  // relación de aspecto de salida
  let ar = rw / rh;
  if (adj.crop === "3:4") ar = 3 / 4;
  else if (adj.crop === "1:1") ar = 1;
  else if (adj.crop === "4:5") ar = 4 / 5;

  // región de recorte (en coordenadas rotadas)
  let cw = rw, ch = rw / ar;
  if (ch > rh) { ch = rh; cw = rh * ar; }
  const z = Math.max(1, adj.zoom || 1);
  cw /= z; ch /= z;
  const cx = (rw - cw) / 2 + (adj.offsetX || 0) * (rw - cw) / 2;
  const cy = (rh - ch) / 2 + (adj.offsetY || 0) * (rh - ch) / 2;

  let ow = cw, oh = ch;
  const scale = Math.min(1, maxSide / Math.max(ow, oh));
  ow = Math.round(ow * scale); oh = Math.round(oh * scale);

  // paso 1: rotar
  const rc = document.createElement("canvas");
  rc.width = rw; rc.height = rh;
  const rctx = rc.getContext("2d");
  rctx.translate(rw / 2, rh / 2); rctx.rotate((rot * Math.PI) / 180);
  rctx.drawImage(bitmap, -sw0 / 2, -sh0 / 2);

  // paso 2: recortar + escalar
  const c = document.createElement("canvas");
  c.width = ow; c.height = oh;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(rc, cx, cy, cw, ch, 0, 0, ow, oh);

  // paso 3: color
  const img = ctx.getImageData(0, 0, ow, oh);
  const d = img.data;
  const stats = adj.auto ? analyze(d) : null;
  const [lr, lg, lb] = buildLUTs(stats, adj);
  const sat = 1 + adj.saturation / 100 + (adj.auto ? 0.12 : 0);
  for (let i = 0; i < d.length; i += 4) {
    let r = lr[d[i]], g = lg[d[i + 1]], b = lb[d[i + 2]];
    if (sat !== 1) {
      const l = r * 0.299 + g * 0.587 + b * 0.114;
      r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  if (adj.auto) cleanBlotches(img, ow, oh);
  sharpen(img, ow, oh, adj.sharpen);
  ctx.putImageData(img, 0, 0);

  if (adj.watermark) drawWatermark(ctx, ow, oh, logo);
  return c;
}

export function toBlob(canvas, quality = 0.86) {
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
}


// ---------- Quitar fondo (se ejecuta en el celular, sin enviar la foto a otro servidor) ----------
export const BACKGROUNDS = {
  white:  { label: "Blanco",  paint: (ctx, w, h) => { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); } },
  studio: { label: "Estudio", paint: (ctx, w, h) => { const g = ctx.createRadialGradient(w / 2, h * 0.42, w * 0.1, w / 2, h * 0.5, Math.max(w, h) * 0.75); g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#e4e7ec"); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); } },
  aqua:   { label: "Celeste", paint: (ctx, w, h) => { const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#e3fbfa"); g.addColorStop(1, "#e6eeff"); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); } },
  pink:   { label: "Rosado",  paint: (ctx, w, h) => { const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#fff0f5"); g.addColorStop(1, "#f3ecff"); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); } },
};

let bgLib = null;
export async function removeBg(bitmap, onProgress) {
  if (!bgLib) bgLib = import("https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm").catch((e) => { bgLib = null; throw e; });
  const lib = await bgLib;
  const fn = lib.removeBackground || lib.default;
  const s = Math.min(1, 1500 / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * s), h = Math.round(bitmap.height * s);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  const input = await new Promise((r) => c.toBlob(r, "image/png"));
  const out = await fn(input, {
    model: "isnet_quint8",
    output: { format: "image/png" },
    progress: (key, cur, total) => onProgress && onProgress(key, cur, total),
  });
  const raw = await createImageBitmap(out);
  const m = document.createElement("canvas"); m.width = raw.width; m.height = raw.height;
  const mctx = m.getContext("2d", { willReadFrequently: true }); mctx.drawImage(raw, 0, 0);
  const img = mctx.getImageData(0, 0, m.width, m.height);
  removeThinParts(img, m.width, m.height); // quita gancho, base metálica, logos sueltos
  mctx.putImageData(img, 0, 0);
  const cutout = m;
  // caja que encierra la prenda (para centrarla)
  const a = img.data;
  let x0 = m.width, y0 = m.height, x1 = 0, y1 = 0;
  for (let y = 0; y < m.height; y += 2) for (let x = 0; x < m.width; x += 2) {
    if (a[(y * m.width + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 <= x0 || y1 <= y0) throw new Error("No se encontró la prenda en la foto");
  return { cutout, bbox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

// Borra partes delgadas pegadas a la prenda (gancho, varilla del soporte) y
// manchas sueltas, dejando solo el cuerpo principal de la prenda.
function minMax1D(src, dst, w, h, r, isMax, horizontal) {
  const len = horizontal ? w : h, lines = horizontal ? h : w;
  for (let l = 0; l < lines; l++) {
    for (let i = 0; i < len; i++) {
      let v = isMax ? 0 : 255;
      const a0 = Math.max(0, i - r), a1 = Math.min(len - 1, i + r);
      for (let k = a0; k <= a1; k++) {
        const idx = horizontal ? l * w + k : k * w + l;
        const x = src[idx];
        if (isMax ? x > v : x < v) { v = x; if (isMax ? v === 255 : v === 0) break; }
      }
      dst[horizontal ? l * w + i : i * w + l] = v;
    }
  }
}
function morph(mask, w, h, r, isMax) {
  const t = new Uint8Array(mask.length), o = new Uint8Array(mask.length);
  minMax1D(mask, t, w, h, r, isMax, true); minMax1D(t, o, w, h, r, isMax, false);
  return o;
}
export function removeThinParts(img, W, H) {
  const sc = Math.min(1, 480 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * sc)), h = Math.max(1, Math.round(H * sc));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const t = document.createElement("canvas"); t.width = W; t.height = H;
  t.getContext("2d").putImageData(img, 0, 0);
  const cx = c.getContext("2d", { willReadFrequently: true }); cx.drawImage(t, 0, 0, w, h);
  const small = cx.getImageData(0, 0, w, h).data;
  let mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = small[i * 4 + 3] > 60 ? 255 : 0;
  const r = Math.max(4, Math.round(Math.max(w, h) * 0.022));
  mask = morph(morph(mask, w, h, r, false), w, h, r, true); // apertura: borra lo delgado
  // conservar solo la pieza más grande (la prenda)
  const lab = new Int32Array(w * h).fill(-1); let best = -1, bestN = 0, id = 0;
  const q = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    let qh = 0, qt = 0, n = 0; q[qt++] = s; lab[s] = id;
    while (qh < qt) {
      const p = q[qh++]; n++; const x = p % w, y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; q[qt++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; q[qt++] = p + 1; }
      if (y > 0 && mask[p - w] && lab[p - w] < 0) { lab[p - w] = id; q[qt++] = p - w; }
      if (y < h - 1 && mask[p + w] && lab[p + w] < 0) { lab[p + w] = id; q[qt++] = p + w; }
    }
    if (n > bestN) { bestN = n; best = id; }
    id++;
  }
  for (let i = 0; i < w * h; i++) mask[i] = lab[i] === best ? 255 : 0;
  mask = morph(mask, w, h, 2, true);
  // llevar la máscara al tamaño real y aplicarla al recorte
  const md = cx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { md.data[i * 4 + 3] = mask[i]; }
  cx.clearRect(0, 0, w, h); cx.putImageData(md, 0, 0);
  const big = document.createElement("canvas"); big.width = W; big.height = H;
  const bx = big.getContext("2d", { willReadFrequently: true }); bx.imageSmoothingQuality = "high"; bx.drawImage(c, 0, 0, W, H);
  const bm = bx.getImageData(0, 0, W, H).data, d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = (d[i] * bm[i]) / 255;
}

// Pone la prenda recortada sobre un fondo limpio, centrada y con sombra suave
export function composeOnBg(item, adj) {
  const { cutout, bbox } = item;
  let ar = bbox.w / bbox.h;
  if (adj.crop === "3:4") ar = 3 / 4; else if (adj.crop === "1:1") ar = 1; else if (adj.crop === "4:5") ar = 4 / 5;
  if (adj.rotate % 180) ar = 1 / ar; // se rota después
  const pad = 1.16;
  let W = bbox.w * pad, H = W / ar;
  if (H < bbox.h * pad) { H = bbox.h * pad; W = H * ar; }
  W = Math.round(W); H = Math.round(H);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  (BACKGROUNDS[adj.bg] || BACKGROUNDS.white).paint(ctx, W, H);
  const dx = (W - bbox.w) / 2 - bbox.x, dy = (H - bbox.h) / 2 - bbox.y;
  ctx.save();
  ctx.shadowColor = "rgba(20,30,60,.22)"; ctx.shadowBlur = Math.round(W * 0.03); ctx.shadowOffsetY = Math.round(W * 0.012);
  ctx.drawImage(cutout, dx, dy);
  ctx.restore();
  return c;
}

// Imagen de origen según el fondo elegido
export function sourceFor(item, adj) {
  return adj.bg && adj.bg !== "none" && item.cutout ? composeOnBg(item, adj) : item.bitmap;
}
