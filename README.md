# Agua Planeta · Tienda virtual

Tienda de ropa con carrito que envía los pedidos a WhatsApp y panel de administración.

- `/` — tienda (catálogo, filtros por categoría y talla, carrito, pedido por WhatsApp)
- `/admin` — panel (subir fotos con edición automática, precios, tallas, inventario, pedidos, ajustes)

## Estructura
- `public/` — páginas (index.html, admin.html), `js/photo.js` (editor de fotos), imágenes
- `netlify/functions/api.mts` — API (productos, fotos, pedidos, ajustes) guardada en Netlify Blobs
- `netlify/lib/seed-data.mts` — las 16 prendas iniciales del catálogo PDF (referencias USA2-xxx)

## Configuración en Netlify
- Variable de entorno `ADMIN_PASSWORD` = contraseña inicial del panel (luego se puede cambiar desde Ajustes).
- Build: sin comando, carpeta publicada `public`.

## Dónde se guardan los datos
Todo lo que la dueña sube desde /admin (prendas, fotos, precios, pedidos y ajustes) se guarda en **Netlify Blobs**,
el almacenamiento del mismo proyecto de Netlify (stores `aguaplaneta-data` y `aguaplaneta-img`). No hay que configurar
nada más: lo que se guarda en el panel lo ven todos los clientes de inmediato y no se pierde al publicar cambios de diseño.
