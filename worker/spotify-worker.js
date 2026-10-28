/* Cloudflare Worker: lee las canciones de una playlist pública de Spotify.
 * Usa la página "embed" de Spotify (no hace falta Premium ni API) y le agrega
 * el permiso CORS para que la app en GitHub Pages pueda leer la respuesta.
 *
 * Uso: GET https://TU-WORKER.workers.dev/?id=31i1DA49WqpASSfzMFxyG1
 * Responde: { nombre, total, canciones: [{ titulo, artistas: [..] }] }
 *
 * Variable opcional ORIGEN (Settings → Variables): por ejemplo
 * https://TU-USUARIO.github.io para que solo tu app pueda usarlo.
 */
export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ORIGEN || "*",
      "Access-Control-Allow-Methods": "GET",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const responder = (datos, status = 200) => new Response(JSON.stringify(datos), {
      status,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "max-age=300" },
    });

    // Solo IDs de playlist: así no sirve como proxy para cualquier cosa
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!/^[A-Za-z0-9]{22}$/.test(id)) return responder({ error: "El link de la playlist no es válido." }, 400);

    const opciones = { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "es" }, cf: { cacheTtl: 300 } };
    const [embed, pagina] = await Promise.all([
      fetch(`https://open.spotify.com/embed/playlist/${id}`, opciones),
      // La página normal dice el total real (el embed trae como máximo 100)
      fetch(`https://open.spotify.com/playlist/${id}`, opciones).catch(() => null),
    ]);

    if (embed.status === 404) return responder({ error: "No encontré la playlist. ¿Es privada?" }, 404);
    if (!embed.ok) return responder({ error: `Spotify respondió ${embed.status}.` }, 502);

    let props;
    try {
      const html = await embed.text();
      const json = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1];
      props = JSON.parse(json).props.pageProps;
    } catch {
      return responder({ error: "No pude leer la página de Spotify (puede que la hayan cambiado)." }, 502);
    }
    // Si la playlist no existe o es privada, la página viene sin datos
    const entidad = props?.state?.data?.entity;
    if (!entidad) return responder({ error: "No encontré la playlist. ¿Es privada?" }, 404);

    const canciones = (entidad.trackList || [])
      .filter((t) => t.entityType === "track")
      // Spotify separa los artistas con ", " usando un espacio duro
      .map((t) => ({ titulo: t.title, artistas: t.subtitle.split(/, /) }));

    let total = canciones.length;
    if (pagina?.ok) {
      const m = (await pagina.text()).match(/<meta name="music:song_count" content="(\d+)"/);
      if (m) total = Math.max(total, Number(m[1]));
    }

    return responder({ nombre: entidad.name || entidad.title || "", total, canciones });
  },
};
