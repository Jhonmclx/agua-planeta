// Edición automática de fotos de ropa (todo ocurre en el celular/PC, antes de subir)
// - Corrige orientación, recorta a 3:4, ajusta niveles/blancos, luz, color y nitidez
// - Agrega el logo USA2 como marca de agua (opcional)
// - Permite ajustes manuales con sliders

export const DEFAULT_ADJ = { auto: true, brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharpen: 35, rotate: 0, crop: "3:4", zoom: 1, offsetX: 0, offsetY: 0, watermark: true };

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
  let sum = 0; for (let i = 0; i < 256; i++) sum += hl[i] * i;
  return { lo, hi, lLo, lHi, mean: sum / n / 255 };
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
  const contrast = 1 + adj.contrast / 100 + (adj.auto ? 0.06 : 0);
  const warm = adj.warmth / 100;
  for (let c = 0; c < 3; c++) {
    let lo = 0, hi = 255;
    if (adj.auto && stats) {
      lo = stats.lLo * (1 - wb) + stats.lo[c] * wb;
      hi = stats.lHi * (1 - wb) + stats.hi[c] * wb;
      lo = Math.min(lo, 60); hi = Math.max(hi, 170);
      if (hi - lo < 40) { lo = 0; hi = 255; }
    }
    for (let i = 0; i < 256; i++) {
      let v = (i - lo) / (hi - lo);
      v = clamp(v, 0, 1);
      v = Math.pow(v, 1 / gamma);
      v = (v - 0.5) * contrast + 0.5 + bright * 0.6;
      if (c === 0) v += warm * 0.08;
      if (c === 2) v -= warm * 0.08;
      luts[c][i] = clamp(Math.round(v * 255));
    }
  }
  return luts;
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
  sharpen(img, ow, oh, adj.sharpen);
  ctx.putImageData(img, 0, 0);

  if (adj.watermark) drawWatermark(ctx, ow, oh, logo);
  return c;
}

export function toBlob(canvas, quality = 0.86) {
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
}
