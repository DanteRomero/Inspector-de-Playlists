# Playlist → YouTube

App web personal: pegás tu playlist (o subís el CSV exportado de Spotify) y te da, para cada canción, el link directo de **YouTube** y de **YouTube Music**. Funciona en GitHub Pages y se instala en el celular como una app.

## 1. Subirla a GitHub Pages

1. Creá un repositorio nuevo en GitHub (por ejemplo `playlist-yt`). Puede ser público.
2. Subí **todos** estos archivos tal cual, con la carpeta `icons/` incluida.
3. En el repo andá a **Settings → Pages**. En *Source* elegí **Deploy from a branch**, rama `main`, carpeta `/ (root)` y guardá.
4. En uno o dos minutos queda online en `https://TU-USUARIO.github.io/playlist-yt/`.

## 2. Conseguir la clave de YouTube (gratis)

1. Entrá a [console.cloud.google.com](https://console.cloud.google.com/) y creá un proyecto.
2. En **APIs y servicios → Biblioteca** buscá **YouTube Data API v3** y activala.
3. En **APIs y servicios → Credenciales** tocá **Crear credenciales → Clave de API**.
4. Restringí la clave (importante, así nadie más la usa):
   - *Restricciones de aplicación*: **Sitios web (referentes HTTP)** → agregá `https://TU-USUARIO.github.io/*`
   - *Restricciones de API*: solo **YouTube Data API v3**.
5. Abrí la app, tocá ⚙️ y pegá la clave. Se guarda solo en ese dispositivo; **no la pongas en el código** del repo.

Límite: 10.000 unidades por día, y cada canción nueva gasta 100, o sea **unas 100 canciones por día**. La cuota se reinicia a la medianoche de California (4 o 5 de la mañana en Argentina). Las canciones que ya buscaste quedan guardadas y no vuelven a gastar. Sin clave, la app igual funciona pero da links de *búsqueda* en vez de directos.

## 3. Instalarla en el celular

- **Android (Chrome):** abrí el link, menú ⋮ → **Instalar app** o **Agregar a pantalla principal**.
- **iPhone (Safari):** botón Compartir → **Agregar a inicio**.

Cuando subas cambios, subí también la versión en `sw.js` (`v1` → `v2`) para que el celular tome lo nuevo.

## 4. Sacar la lista de tu playlist de Spotify

Sin Spotify Premium no se puede leer la playlist directo desde la app, así que hay dos caminos:

- **Exportar a CSV** con un exportador como [Exportify](https://exportify.net) y subir ese archivo en la pestaña *Subir CSV*. La app reconoce las columnas de canción y artista de Exportify, TuneMyMusic y similares. (Spotify cambió su API en 2026, así que algún exportador puede dejar de andar.)
- **Pegar la lista** a mano, una canción por línea: `Artista - Canción`.

## Botones de resultados

- **▶ Reproducir todo:** abre en YouTube una lista temporal con los temas (hasta 50 por vez; si hay más, aparecen botones por tandas).
- **Copiar links / Descargar .txt:** todos los links juntos.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | La pantalla |
| `styles.css` | Estilos (modo claro y oscuro automático) |
| `app.js` | Lectura de la lista, búsqueda en YouTube, resultados |
| `manifest.webmanifest`, `sw.js`, `icons/` | Lo que la hace instalable y usable sin conexión |
