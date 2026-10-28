/* Playlist → YouTube
 * App estática (GitHub Pages). Busca cada canción con la YouTube Data API v3
 * y arma links directos a YouTube y YouTube Music.
 */
"use strict";

// ------------------------------------------------------------ almacenamiento
const store = {
  get(k, def = null) {
    try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); }
    catch { return def; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const CLAVE_API = "yt_api_key";
const CACHE = "yt_cache";       // { consulta: {id, titulo, canal, thumb} }
const CUOTA = "yt_cuota";       // { dia: "YYYY-MM-DD", usada: n }
const ULTIMA = "ultima_lista";  // última lista procesada

// ------------------------------------------------------------ utilidades
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function normalizar(t) {
  return (t || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

function decodificar(html) {
  const t = document.createElement("textarea");
  t.innerHTML = html;
  return t.value;
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("visible");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("visible"), 2400);
}

// La cuota de YouTube se reinicia a medianoche hora del Pacífico
function diaPacifico() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}
function cuotaUsada() {
  const c = store.get(CUOTA, {});
  return c.dia === diaPacifico() ? c.usada : 0;
}
function sumarCuota(n) {
  store.set(CUOTA, { dia: diaPacifico(), usada: cuotaUsada() + n });
}

// ------------------------------------------------------------ lectura de canciones
/** Texto: una canción por línea. Ignora vacías, numeraciones y encabezados. */
function leerTexto(texto) {
  return texto.split(/\r?\n/)
    .map((l) => l.replace(/^\s*\d+[\.\)\-]\s*/, "").trim())
    .filter((l) => l && !/^https?:\/\//i.test(l))
    .map((l) => ({ nombre: l, consulta: l }));
}

/** Parser CSV que respeta comillas, comas y saltos de línea dentro de campos. */
function parsearCSV(texto) {
  const filas = [];
  let fila = [], campo = "", comillas = false;
  texto = texto.replace(/^﻿/, "");
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === "," || c === ";") {
      // Algunos exportadores usan ; como separador
      if (c === ";" && !parsearCSV._puntoYComa) { campo += c; continue; }
      fila.push(campo); campo = "";
    }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo); filas.push(fila); fila = []; campo = "";
    } else campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((x) => x.trim() !== ""));
}

/** Detecta columnas de canción y artista (Exportify, TuneMyMusic, etc.). */
function leerCSV(texto) {
  const primera = texto.split(/\r?\n/)[0] || "";
  parsearCSV._puntoYComa = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length;
  const filas = parsearCSV(texto);
  if (filas.length < 2) throw new Error("El CSV está vacío.");

  const cab = filas[0].map((h) => normalizar(h));
  const buscar = (...claves) => cab.findIndex((h) => claves.some((k) => h === k || h.includes(k)));

  const iCancion = buscar("track name", "song name", "title", "name", "cancion", "titulo", "nombre");
  const iArtista = buscar("artist name", "artist", "artista");
  if (iCancion < 0) throw new Error("No encontré la columna con el nombre de la canción.");

  return filas.slice(1).map((f) => {
    const cancion = (f[iCancion] || "").trim();
    const artistas = iArtista >= 0 ? (f[iArtista] || "").trim() : "";
    // Para buscar alcanza con el artista principal
    const principal = artistas.split(/\s*[,;&]\s*|\s+feat\.?\s+/i)[0] || "";
    return {
      nombre: artistas ? `${artistas.replace(/;/g, ", ")} - ${cancion}` : cancion,
      consulta: `${principal} ${cancion}`.trim(),
    };
  }).filter((x) => x.consulta);
}

// ------------------------------------------------------------ YouTube
class CuotaAgotada extends Error {}
class ClaveInvalida extends Error {}

async function buscarEnYouTube(consulta, clave, signal) {
  const cache = store.get(CACHE, {});
  const k = normalizar(consulta);
  if (cache[k]) return { ...cache[k], deCache: true };

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({
    part: "snippet", type: "video", maxResults: "1",
    videoCategoryId: "10", // categoría Música
    q: consulta, key: clave,
  });

  const r = await fetch(url, { signal });
  const data = await r.json().catch(() => ({}));
  sumarCuota(100);

  if (!r.ok) {
    const motivo = data?.error?.errors?.[0]?.reason || "";
    if (/quota/i.test(motivo)) throw new CuotaAgotada();
    if (/keyInvalid|forbidden|ipRefererBlocked|accessNotConfigured/i.test(motivo) || r.status === 400 || r.status === 403)
      throw new ClaveInvalida(data?.error?.message || motivo);
    throw new Error(data?.error?.message || `Error ${r.status}`);
  }

  const v = data.items?.[0];
  if (!v) return null;
  const res = {
    id: v.id.videoId,
    titulo: decodificar(v.snippet.title),
    canal: decodificar(v.snippet.channelTitle).replace(/ - Topic$/, ""),
    thumb: v.snippet.thumbnails?.default?.url || "",
  };
  // Releer antes de guardar: hay varias búsquedas en paralelo
  const actual = store.get(CACHE, {});
  actual[k] = res;
  store.set(CACHE, actual);
  return res;
}

const linkYT = (id) => `https://www.youtube.com/watch?v=${id}`;
const linkYTM = (id) => `https://music.youtube.com/watch?v=${id}`;
const busquedaYT = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
const busquedaYTM = (q) => `https://music.youtube.com/search?q=${encodeURIComponent(q)}`;

// ------------------------------------------------------------ estado
let canciones = [];   // [{nombre, consulta}]
let resultados = [];  // [{nombre, consulta, video|null, error?}]
let controlador = null;

// ------------------------------------------------------------ UI: entrada
function actualizarContador() {
  $("#contador").textContent = `${canciones.length} ${canciones.length === 1 ? "canción" : "canciones"}`;
  $("#btn-buscar").disabled = canciones.length === 0 || !!controlador;
}

function tabActiva() { return $(".tab.activa").dataset.tab; }

$$(".tab").forEach((t) => t.addEventListener("click", () => {
  $$(".tab").forEach((x) => { x.classList.toggle("activa", x === t); x.setAttribute("aria-selected", x === t); });
  $$(".panel").forEach((p) => (p.hidden = p.dataset.panel !== t.dataset.tab));
  if (t.dataset.tab === "texto") canciones = leerTexto($("#entrada").value);
  else canciones = cancionesCSV;
  actualizarContador();
}));

$("#entrada").addEventListener("input", (e) => {
  canciones = leerTexto(e.target.value);
  actualizarContador();
});

let cancionesCSV = [];
async function cargarArchivo(file) {
  if (!file) return;
  try {
    cancionesCSV = leerCSV(await file.text());
    $("#csv-estado").textContent = `✔ ${file.name}: ${cancionesCSV.length} canciones`;
  } catch (e) {
    cancionesCSV = [];
    $("#csv-estado").textContent = `✖ ${e.message}`;
  }
  if (tabActiva() === "csv") { canciones = cancionesCSV; actualizarContador(); }
}
$("#archivo").addEventListener("change", (e) => cargarArchivo(e.target.files[0]));
const drop = $("#drop");
["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("encima"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("encima")));
drop.addEventListener("drop", (e) => { e.preventDefault(); cargarArchivo(e.dataTransfer.files[0]); });

// ------------------------------------------------------------ UI: resultados
function crearItem(r, i) {
  const li = document.createElement("li");
  li.className = "item";

  const thumb = r.video?.thumb
    ? Object.assign(document.createElement("img"), { className: "thumb", src: r.video.thumb, alt: "", loading: "lazy" })
    : Object.assign(document.createElement("div"), { className: "thumb", textContent: i + 1 });

  const info = document.createElement("div");
  info.className = "info";
  const nombre = Object.assign(document.createElement("div"), { className: "nombre", textContent: `${i + 1}. ${r.nombre}` });
  info.append(nombre);

  if (r.video) {
    info.append(Object.assign(document.createElement("div"), {
      className: "encontrado", textContent: `${r.video.titulo} · ${r.video.canal}`,
    }));
  } else if (r.error) {
    info.append(Object.assign(document.createElement("div"), { className: "estado-error", textContent: r.error }));
  }

  const links = document.createElement("div");
  links.className = "links";
  const chip = (href, txt, cls) => Object.assign(document.createElement("a"), {
    href, textContent: txt, className: `chip ${cls}`, target: "_blank", rel: "noopener",
  });
  if (r.video) {
    links.append(chip(linkYT(r.video.id), "▶ YouTube", "yt"), chip(linkYTM(r.video.id), "♪ YT Music", "ytm"));
  } else {
    links.append(chip(busquedaYT(r.consulta), "Buscar en YouTube", "busqueda yt"),
                 chip(busquedaYTM(r.consulta), "Buscar en YT Music", "busqueda ytm"));
  }
  info.append(links);
  li.append(thumb, info);
  return li;
}

function pintarResultados() {
  $("#resultados-card").hidden = resultados.length === 0;
  const lista = $("#lista");
  lista.replaceChildren(...resultados.map(crearItem));

  const conVideo = resultados.filter((r) => r.video);
  $("#resumen").textContent = `${conVideo.length}/${resultados.length} con link directo`;
  $("#btn-reproducir").disabled = conVideo.length === 0;

  // YouTube arma una lista temporal con hasta 50 videos por link
  const tandas = $("#tandas");
  tandas.replaceChildren();
  const ids = conVideo.map((r) => r.video.id);
  if (ids.length > 50) {
    for (let i = 0; i < ids.length; i += 50) {
      const a = Object.assign(document.createElement("a"), {
        className: "chip", target: "_blank", rel: "noopener",
        href: urlReproducir(ids.slice(i, i + 50)),
        textContent: `▶ Temas ${i + 1}–${Math.min(i + 50, ids.length)}`,
      });
      tandas.append(a);
    }
  }
}

const urlReproducir = (ids) => `https://www.youtube.com/watch_videos?video_ids=${ids.join(",")}`;

function textoLinks() {
  return resultados.map((r, i) => {
    const yt = r.video ? linkYT(r.video.id) : busquedaYT(r.consulta);
    const ytm = r.video ? linkYTM(r.video.id) : busquedaYTM(r.consulta);
    return `${i + 1}. ${r.nombre}\n   YouTube: ${yt}\n   YouTube Music: ${ytm}`;
  }).join("\n\n");
}

$("#btn-reproducir").addEventListener("click", () => {
  const ids = resultados.filter((r) => r.video).map((r) => r.video.id);
  if (ids.length > 50) toast("Se abren los primeros 50. Usá los botones de tandas para el resto.");
  window.open(urlReproducir(ids.slice(0, 50)), "_blank", "noopener");
});

$("#btn-copiar").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(textoLinks()); toast("Links copiados"); }
  catch { toast("No se pudo copiar"); }
});

$("#btn-txt").addEventListener("click", () => {
  const blob = new Blob([textoLinks()], { type: "text/plain;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "playlist-youtube.txt" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ------------------------------------------------------------ búsqueda
async function buscarTodo() {
  if (!canciones.length) return;
  const clave = store.get(CLAVE_API, "");
  resultados = canciones.map((c) => ({ ...c, video: null }));

  if (!clave) {
    pintarResultados();
    $("#resultados-card").scrollIntoView({ behavior: "smooth" });
    return;
  }

  controlador = new AbortController();
  actualizarContador();
  $("#progreso").hidden = false;
  let hechas = 0, nuevas = 0, frenar = null;

  const avanzar = () => {
    hechas++;
    $("#barra-relleno").style.width = `${(hechas / resultados.length) * 100}%`;
    $("#progreso-txt").textContent = `${hechas}/${resultados.length} · ${nuevas} búsquedas nuevas`;
  };
  avanzar(); hechas--; // muestra 0/N

  // 3 búsquedas en paralelo
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < resultados.length && !frenar && !controlador.signal.aborted) {
      const r = resultados[siguiente++];
      try {
        const v = await buscarEnYouTube(r.consulta, clave, controlador.signal);
        if (v && !v.deCache) nuevas++;
        r.video = v;
        if (!v) r.error = "Sin resultados";
      } catch (e) {
        if (e.name === "AbortError") return;
        if (e instanceof CuotaAgotada) { frenar = "Se terminó la cuota diaria de YouTube. Las que faltan quedan con link de búsqueda."; return; }
        if (e instanceof ClaveInvalida) { frenar = `La clave no funciona: ${e.message}`; return; }
        r.error = e.message;
      }
      avanzar();
    }
  }
  await Promise.all([trabajador(), trabajador(), trabajador()]);

  controlador = null;
  $("#progreso").hidden = true;
  actualizarContador();
  store.set(ULTIMA, resultados);
  pintarResultados();
  if (frenar) toast(frenar);
  $("#resultados-card").scrollIntoView({ behavior: "smooth" });
}

$("#btn-buscar").addEventListener("click", buscarTodo);
$("#btn-cancelar").addEventListener("click", () => controlador?.abort());

// ------------------------------------------------------------ ajustes
const dlg = $("#ajustes");
function abrirAjustes() {
  $("#clave").value = store.get(CLAVE_API, "");
  const usada = cuotaUsada();
  $("#cuota-hoy").textContent = `Hoy usaste aprox. ${usada} de 10.000 unidades (${Math.max(0, Math.floor((10000 - usada) / 100))} búsquedas disponibles).`;
  dlg.showModal();
}
$("#btn-ajustes").addEventListener("click", abrirAjustes);
$$("[data-abrir-ajustes]").forEach((b) => b.addEventListener("click", abrirAjustes));
$("#btn-guardar").addEventListener("click", () => {
  const v = $("#clave").value.trim();
  v ? store.set(CLAVE_API, v) : store.del(CLAVE_API);
  actualizarAviso();
  toast(v ? "Clave guardada" : "Clave borrada");
});
$("#btn-borrar-cache").addEventListener("click", () => {
  store.del(CACHE);
  toast("Canciones guardadas borradas");
});

function actualizarAviso() { $("#aviso-clave").hidden = !!store.get(CLAVE_API, ""); }

// ------------------------------------------------------------ inicio
actualizarAviso();
actualizarContador();
resultados = store.get(ULTIMA, []);
if (resultados.length) pintarResultados();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// Exportado para pruebas (no afecta a la app)
window.__test = { leerTexto, leerCSV, normalizar };
