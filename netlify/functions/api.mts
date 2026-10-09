import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import seed from "../lib/seed-data.mts";
import IMPORTS from "../lib/imports.mts";

// ---------- tipos ----------
type Size = { size: string; stock: number };
type Product = {
  id: string;
  ref: string;
  name: string;
  category: string;
  price: number;
  oldPrice?: number;
  sizes: Size[];
  photos: string[];
  description?: string;
  gender?: string;
  brand?: string;
  status: "available" | "sold" | "hidden";
  featured?: boolean;
  isNew?: boolean;
  colors?: string[];
  condition?: string;
  measures?: string;
  createdAt: number;
  updatedAt?: number;
};
type OrderItem = { id: string; ref: string; name: string; size: string; qty: number; price: number };
type Order = {
  id: string;
  createdAt: number;
  customer: { name: string; phone?: string; city?: string; address?: string; notes?: string; payment?: string; delivery?: string };
  items: OrderItem[];
  total: number;
  status: "new" | "confirmed" | "cancelled";
};

const DEFAULT_SETTINGS = {
  storeName: "Agua Planeta",
  tagline: "Ropa americana y nacional con estilo, a precios que te encantan.",
  whatsapp: "573124037050",
  instagram: "",
  city: "",
  paymentInfo: "Nequi / Daviplata / Transferencia / Contra entrega",
  shippingInfo: "Envíos a todo el país. El valor del envío se confirma por WhatsApp.",
  categories: ["Buzos", "Chaquetas", "Camisetas", "Jeans", "Vestidos", "Faldas", "Shorts", "Zapatos", "Accesorios"],
  sizes: ["XS", "S", "M", "L", "XL", "XXL"],
  refPrefix: "USA2",
  watermark: true,
  announcement: "🌊 Prendas únicas: cuando se vende, ¡no vuelve!",
  pickupInfo: "",
  faqChanges: "Antes de comprar, pregúntanos por WhatsApp las condiciones de cambio de la prenda.",
  faqSizes: "Cada prenda muestra su talla y, cuando las tenemos, sus medidas. Si tienes dudas, escríbenos y te ayudamos a escoger.",
};
type Settings = typeof DEFAULT_SETTINGS & { passwordHash?: string };

// ---------- utilidades ----------
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });

const store = () => getStore({ name: "aguaplaneta-data", consistency: "strong" });
const imgStore = () => getStore({ name: "aguaplaneta-img" });

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function rid(n = 10) {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  const r = crypto.getRandomValues(new Uint8Array(n));
  for (const x of r) s += a[x % a.length];
  return s;
}

async function getSettings(): Promise<Settings> {
  const s = (await store().get("settings", { type: "json" })) as Settings | null;
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

async function getProducts(): Promise<Product[]> {
  let p = (await store().get("products", { type: "json" })) as Product[] | null;
  if (!p) {
    p = seed as Product[];
    await store().setJSON("products", p);
  }
  return applyImports(p);
}

// Agrega una sola vez los lotes nuevos de prendas (sin tocar las existentes)
async function applyImports(products: Product[]): Promise<Product[]> {
  const applied = ((await store().get("imports-applied", { type: "json" })) as string[] | null) || [];
  type Batch = { id: string; products?: Product[]; patch?: { refPrefix: string; set: Partial<Product>; onlyIfEmpty?: boolean } };
  const pending = (IMPORTS as Batch[]).filter((b) => !applied.includes(b.id));
  if (!pending.length) return products;
  const have = new Set(products.flatMap((x) => [x.ref, x.id]));
  const added: Product[] = [];
  for (const b of pending) for (const item of b.products || []) {
    if (have.has(item.ref) || have.has(item.id)) continue;
    added.push({ ...item, createdAt: Date.now() - added.length });
    have.add(item.ref); have.add(item.id);
  }
  const next = [...added, ...products];
  // cambios en bloque (solo llena campos vacíos si onlyIfEmpty)
  for (const b of pending) if (b.patch) {
    for (const p of next) {
      if (!p.ref.startsWith(b.patch.refPrefix)) continue;
      for (const [k, v] of Object.entries(b.patch.set)) {
        if (b.patch.onlyIfEmpty && (p as any)[k]) continue;
        (p as any)[k] = v;
      }
    }
  }
  await store().setJSON("products", next);
  await store().setJSON("imports-applied", [...applied, ...pending.map((b) => b.id)]);
  return next;
}
const saveProducts = (p: Product[]) => store().setJSON("products", p);

async function getOrders(): Promise<Order[]> {
  return ((await store().get("orders", { type: "json" })) as Order[] | null) || [];
}
const saveOrders = (o: Order[]) => store().setJSON("orders", o.slice(0, 500));

async function isAdmin(req: Request) {
  const pass = req.headers.get("x-admin-password") || "";
  if (!pass) return false;
  const s = await getSettings();
  if (s.passwordHash) return (await sha256(pass)) === s.passwordHash;
  const envPass = Netlify.env.get("ADMIN_PASSWORD") || "";
  return !!envPass && pass === envPass;
}

const num = (v: unknown) => {
  const n = Math.round(Number(String(v ?? "").replace(/[^\d.-]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const str = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);

function cleanProduct(input: any, existing?: Product): Product {
  const sizes: Size[] = Array.isArray(input.sizes)
    ? input.sizes
        .map((s: any) => ({ size: str(s.size, 12).toUpperCase(), stock: Math.max(0, Math.round(Number(s.stock) || 0)) }))
        .filter((s: Size) => s.size)
    : existing?.sizes || [];
  const status = ["available", "sold", "hidden"].includes(input.status) ? input.status : existing?.status || "available";
  return {
    id: existing?.id || input.id || rid(),
    ref: str(input.ref, 30) || existing?.ref || "",
    name: str(input.name, 120) || existing?.name || "Prenda",
    category: str(input.category, 40) || existing?.category || "Otros",
    price: num(input.price),
    oldPrice: num(input.oldPrice),
    sizes,
    photos: Array.isArray(input.photos) ? input.photos.map((p: any) => str(p, 300)).filter(Boolean).slice(0, 10) : existing?.photos || [],
    description: str(input.description, 1500),
    gender: str(input.gender, 20),
    brand: str(input.brand, 60),
    status,
    featured: !!input.featured,
    isNew: !!input.isNew,
    colors: Array.isArray(input.colors) ? [...new Set(input.colors.map((c: any) => str(c, 24)).filter(Boolean))].slice(0, 12) : existing?.colors || [],
    condition: ["nuevo", "como-nuevo", "buen-estado"].includes(input.condition) ? input.condition : "",
    measures: str(input.measures, 300),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

function nextRef(products: Product[], prefix: string) {
  let max = 0;
  for (const p of products) {
    const m = p.ref.match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return (n: number) => `${prefix}-${String(max + n).padStart(3, "0")}`;
}

// Vista pública: sin cantidades exactas de inventario
function publicView(p: Product) {
  const total = p.sizes.reduce((a, s) => a + s.stock, 0);
  return {
    id: p.id,
    ref: p.ref,
    name: p.name,
    category: p.category,
    price: p.price,
    oldPrice: p.oldPrice || 0,
    sizes: p.sizes.filter((s) => s.stock > 0).map((s) => ({ size: s.size, max: Math.min(s.stock, 10) })),
    photos: p.photos,
    description: p.description,
    gender: p.gender,
    brand: p.brand,
    soldOut: p.status === "sold" || total <= 0,
    lastUnit: total === 1,
    lowStock: total === 2,
    featured: !!p.featured,
    isNew: !!p.isNew,
    colors: p.colors || [],
    condition: p.condition || "",
    measures: p.measures || "",
    createdAt: p.createdAt,
  };
}

function publicSettings(s: Settings) {
  const { passwordHash, ...rest } = s;
  return rest;
}

// ---------- handler ----------
export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const parts = path.split("/").filter(Boolean);
  const method = req.method.toUpperCase();

  try {
    // ---- imágenes ----
    if (parts[0] === "img" && parts[1] && method === "GET") {
      const res = await imgStore().getWithMetadata(parts[1], { type: "arrayBuffer" });
      if (!res) return new Response("No encontrada", { status: 404 });
      return new Response(res.data as ArrayBuffer, {
        headers: {
          "content-type": (res.metadata as any)?.type || "image/jpeg",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    }

    // ---- público ----
    if (parts[0] === "catalog" && method === "GET") {
      const [products, settings] = await Promise.all([getProducts(), getSettings()]);
      // solo se muestran en la tienda las prendas que ya tienen precio
      const visible = products.filter((p) => p.status !== "hidden" && p.photos.length && p.price > 0);
      return json(
        { settings: publicSettings(settings), products: visible.map(publicView) },
        200,
        { "cache-control": "no-store" }
      );
    }

    if (parts[0] === "orders" && method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body || !Array.isArray(body.items) || !body.items.length) return json({ error: "Pedido vacío" }, 400);
      const products = await getProducts();
      const items: OrderItem[] = [];
      for (const it of body.items.slice(0, 50)) {
        const p = products.find((x) => x.id === it.id);
        if (!p) continue;
        items.push({ id: p.id, ref: p.ref, name: p.name, size: str(it.size, 12), qty: Math.max(1, Math.min(10, Number(it.qty) || 1)), price: p.price });
      }
      if (!items.length) return json({ error: "Productos no encontrados" }, 400);
      const c = body.customer || {};
      const order: Order = {
        id: rid(6).toUpperCase(),
        createdAt: Date.now(),
        customer: {
          name: str(c.name, 80),
          phone: str(c.phone, 30),
          city: str(c.city, 60),
          address: str(c.address, 160),
          notes: str(c.notes, 400),
          payment: str(c.payment, 60),
          delivery: str(c.delivery, 60),
        },
        items,
        total: items.reduce((a, i) => a + i.price * i.qty, 0),
        status: "new",
      };
      const orders = await getOrders();
      orders.unshift(order);
      await saveOrders(orders);
      return json({ ok: true, id: order.id, total: order.total });
    }

    if (parts[0] === "login" && method === "POST") {
      return (await isAdmin(req)) ? json({ ok: true }) : json({ error: "Contraseña incorrecta" }, 401);
    }

    // ---- administración ----
    if (!(await isAdmin(req))) return json({ error: "No autorizado" }, 401);

    if (parts[0] === "upload" && method === "POST") {
      const type = req.headers.get("content-type") || "image/jpeg";
      if (!/^image\/(jpeg|png|webp)$/.test(type)) return json({ error: "Formato no permitido" }, 400);
      const buf = await req.arrayBuffer();
      if (buf.byteLength > 4_500_000) return json({ error: "Imagen muy pesada" }, 413);
      const key = `${Date.now().toString(36)}-${rid(8)}.${type.split("/")[1].replace("jpeg", "jpg")}`;
      await imgStore().set(key, buf, { metadata: { type } });
      return json({ ok: true, url: `/api/img/${key}` });
    }

    if (parts[0] === "admin" && parts[1] === "products") {
      const products = await getProducts();
      const settings = await getSettings();

      if (method === "GET") return json({ products, settings: publicSettings(settings) });

      if (method === "POST") {
        const body = await req.json();
        const list = Array.isArray(body) ? body : [body];
        const ref = nextRef(products, settings.refPrefix || "USA2");
        const created: Product[] = [];
        list.slice(0, 100).forEach((raw: any, i: number) => {
          const p = cleanProduct(raw);
          if (!p.ref || products.some((x) => x.ref === p.ref)) p.ref = ref(i + 1);
          created.push(p);
        });
        const next = [...[...created].reverse(), ...products];
        await saveProducts(next);
        return json({ ok: true, products: created });
      }

      const id = parts[2];
      const idx = products.findIndex((p) => p.id === id);
      if (idx < 0) return json({ error: "Producto no encontrado" }, 404);

      if (method === "PUT") {
        const body = await req.json();
        products[idx] = cleanProduct({ ...products[idx], ...body }, products[idx]);
        await saveProducts(products);
        return json({ ok: true, product: products[idx] });
      }
      if (method === "DELETE") {
        const [removed] = products.splice(idx, 1);
        await saveProducts(products);
        // borrar fotos subidas que ya nadie usa
        const used = new Set(products.flatMap((p) => p.photos));
        for (const ph of removed.photos) {
          if (ph.startsWith("/api/img/") && !used.has(ph)) await imgStore().delete(ph.replace("/api/img/", ""));
        }
        return json({ ok: true });
      }
    }

    if (parts[0] === "admin" && parts[1] === "settings") {
      if (method === "GET") return json(publicSettings(await getSettings()));
      if (method === "PUT") {
        const body = await req.json();
        const cur = await getSettings();
        const next: Settings = { ...cur };
        for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]) {
          if (!(k in body)) continue;
          const v = body[k];
          if (k === "categories" || k === "sizes") {
            (next as any)[k] = Array.isArray(v) ? [...new Set(v.map((x: any) => str(x, 40)).filter(Boolean))].slice(0, 40) : cur[k];
          } else if (k === "watermark") {
            next.watermark = !!v;
          } else if (k === "whatsapp") {
            let w = String(v).replace(/\D/g, "");
            if (w.length === 10 && w.startsWith("3")) w = "57" + w;
            next.whatsapp = w;
          } else {
            (next as any)[k] = str(v, 400);
          }
        }
        if (body.newPassword) {
          if (String(body.newPassword).length < 6) return json({ error: "La contraseña debe tener mínimo 6 caracteres" }, 400);
          next.passwordHash = await sha256(String(body.newPassword));
        }
        await store().setJSON("settings", next);
        return json({ ok: true, settings: publicSettings(next) });
      }
    }

    if (parts[0] === "admin" && parts[1] === "orders") {
      const orders = await getOrders();
      if (method === "GET") return json({ orders });
      const id = parts[2];
      const o = orders.find((x) => x.id === id);
      if (!o) return json({ error: "Pedido no encontrado" }, 404);
      if (method === "PUT") {
        const body = await req.json();
        const status = body.status;
        if (status === "confirmed" && o.status !== "confirmed") {
          // descontar inventario
          const products = await getProducts();
          for (const it of o.items) {
            const p = products.find((x) => x.id === it.id);
            if (!p) continue;
            const s = p.sizes.find((x) => x.size === it.size);
            if (s) s.stock = Math.max(0, s.stock - it.qty);
            if (p.sizes.reduce((a, x) => a + x.stock, 0) <= 0) p.status = "sold";
            p.updatedAt = Date.now();
          }
          await saveProducts(products);
        }
        if (["new", "confirmed", "cancelled"].includes(status)) o.status = status;
        await saveOrders(orders);
        return json({ ok: true, order: o });
      }
      if (method === "DELETE") {
        await saveOrders(orders.filter((x) => x.id !== id));
        return json({ ok: true });
      }
    }

    return json({ error: "Ruta no encontrada" }, 404);
  } catch (err: any) {
    console.error(err);
    return json({ error: "Error del servidor", detail: String(err?.message || err) }, 500);
  }
};

export const config: Config = {
  path: "/api/*",
};
