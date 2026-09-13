const CLIENT_ID = "07f8e60ada964056b6600e6f47c00716";
const REDIRECT  = location.origin + location.pathname; // cadastre essa URL exata no dashboard
const SCOPE     = "user-read-currently-playing user-read-playback-state user-modify-playback-state";
const SCOPE_V   = "3"; // sobe quando muda o escopo: forca reconexao

const $ = s => document.querySelector(s);
const el = {
  wrap:      $(".wrap"),
  sleeve:    $(".sleeve"),
  sleeveImg: $(".sleeve__img"),
  labelImg:  $(".disc__label-img"),
  disc:      $(".disc"),
  title:     $(".now__title"),
  topAlbum:  $(".top__album"),
  topArtist: $(".top__artist"),
  bg:        $(".bg"),
  stage:     $(".stage"),
  artistImgs: [...document.querySelectorAll(".artist__img")],
  viewtoggle:$(".viewtoggle"),
  prev:      $('[data-act="prev"]'),
  main:      $('[data-act="toggle"]'),
  next:      $('[data-act="next"]'),
  hint:      $(".hint"),
  tracks:    $(".tracks"),
  statusText:$(".status__text"),
  retry:     $(".retry"),
  connectBtn:$(".connect-btn"),
  disconnect:$(".disconnect"),
  fs:        $(".fs"),
  cfg:       $(".cfg"),
  cfgModal:  $(".cfg-modal"),
  cfgFanart: $(".cfg-fanart"),
};

const fmt = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
// "Nome do album · 1999" - ano vem de release_date (item.album.release_date, ja
// no retorno de /me/player/currently-playing, sem chamada extra), 4 primeiros
// caracteres cobrem as 3 precisoes que a API manda (year/month/day).
const albumLabel = (name, releaseDate) => {
  const year = (releaseDate || "").slice(0, 4);
  return year ? `${name} · ${year}` : (name || "");
};

function setState(s, msg) {
  el.wrap.dataset.state = s;
  const off = s !== "playing";
  [el.prev, el.main, el.next].forEach(b => (b.disabled = off));
  el.statusText.textContent = msg || "";   // nunca deixa mensagem antiga presa
}
function forceAuth() {
  ["access_token", "refresh_token", "expires_at", "vp_snapshot"].forEach(k => localStorage.removeItem(k));
  snapshot = null;
  setState("auth");
}

// cenario completo da tela: ultima faixa/album/capa/artista. Sobrevive ao reload
// e ao parar a reproducao (fica pausado, com todos os dados).
let snapshot = null;
function persistSnapshot() {
  try { localStorage.setItem("vp_snapshot", JSON.stringify(snapshot)); } catch {}
}
function renderSnapshot(s) {
  if (!s || !s.coverUrl) return;
  // topo: artista (serif grande) > album (mono medio). Embaixo do vinil
  // (now__title), destaque e so a musica.
  if (el.title.textContent !== (s.trackName || "")) el.title.textContent = s.trackName || "";
  if (el.topArtist.textContent !== (s.artistNames || "")) el.topArtist.textContent = s.artistNames || "";
  const snapAlbumText = albumLabel(s.albumName, s.albumReleaseDate);
  if (el.topAlbum.textContent !== snapAlbumText) el.topAlbum.textContent = snapAlbumText;
  if (el.sleeveImg.dataset.src !== (s.coverUrl || "")) {
    el.sleeveImg.dataset.src = s.coverUrl || "";
    el.sleeveImg.dataset.albumId = s.albumId || "";
    el.labelImg.dataset.src = s.coverUrl || "";
    applyCover(s.coverUrl || "", s.albumName || "", s.albumId || "", false);
  }
  setBg(s.coverUrl || "");
  if (s.artistPhotoUrl) {
    artistUrl = s.artistPhotoUrl;
    showArtistImage(s.artistPhotoUrl, true);
  } else {
    setArtistPhoto("");
  }
  cur = {
    isPlaying: false,
    progressMs: s.progressMs || 0,
    durationMs: s.durationMs || 0,
    sync: Date.now(),
    trackId: s.trackId || null,
    albumId: s.albumId || null,
    artistId: s.artistId || null,
    artistName: s.artistName || "",
  };
  el.disc.classList.remove("is-playing");
  reflectPlaying();
  buscarImagensDoArtista(cur.artistId, cur.artistName);
}

// aplica a capa; com spin=true faz o giro de troca de album
function applyCover(url, alt, albumId, spin) {
  const set = () => {
    if (url) {
      el.sleeveImg.src = url; el.sleeveImg.alt = alt || "";
      el.labelImg.src = url; el.labelImg.hidden = false;
      el.wrap.dataset.hasCover = "true";
    } else {
      el.sleeveImg.removeAttribute("src"); el.sleeveImg.alt = "";
      el.labelImg.removeAttribute("src"); el.labelImg.hidden = true;
      el.wrap.dataset.hasCover = "false";
    }
  };
  if (!spin) { set(); return; }
  el.sleeve.classList.remove("flip");
  void el.sleeve.offsetWidth;                 // reinicia a animacao
  el.sleeve.classList.add("flip");
  setTimeout(set, 250);                       // troca no meio da volta
  setTimeout(() => el.sleeve.classList.remove("flip"), 520);
}

// fundo desfocado: mesma capa do album, crossfade na troca
let bgUrl = "";
function setBg(url) {
  if (url === bgUrl) return;
  bgUrl = url;
  if (!url) { el.bg.classList.remove("on"); return; }
  const pre = new Image();
  pre.onload = () => {
    if (bgUrl !== url) return;               // ja mudou de novo
    el.bg.src = url;
    el.bg.classList.add("on");
  };
  pre.src = url;
}

// foto do artista (avatar), cacheada por id — usada no modo capa
let artistImgCache = { id: null, url: "" };
async function artistImage(id) {
  if (!id) return "";
  if (id === artistImgCache.id) return artistImgCache.url;
  try {
    const a = await api("https://api.spotify.com/v1/artists/" + id);
    artistImgCache = { id, url: a.images?.[0]?.url || "" };
  } catch { artistImgCache = { id, url: "" }; }
  return artistImgCache.url;
}
let artistUrl = "";
let artistLayer = 0;
function showArtistImage(url, imediato) {
  if (!url) return;
  const next = el.artistImgs[artistLayer ^ 1];
  const prev = el.artistImgs[artistLayer];
  const aplica = () => {
    next.src = url;
    el.wrap.dataset.hasArtist = "true";
    next.classList.add("is-on");
    prev.classList.remove("is-on");
    artistLayer ^= 1;
  };
  if (imediato) { aplica(); return; }
  const pre = new Image();
  pre.onload = () => {
    if (artistUrl !== url) return;
    aplica();
  };
  pre.src = url;
}

function setArtistPhoto(url) {
  if (url === artistUrl) return;
  artistUrl = url;
  if (!url) {
    el.wrap.dataset.hasArtist = "false";
    el.artistImgs.forEach(i => i.removeAttribute("src"));
    return;
  }
  showArtistImage(url);
}

const FANART_PROJETO = "10ecb43d661dad793e6b0fb409dc65b7";
const FANART_TRIES   = 3;
const FANART_STORE   = "vp_fanart";
const FANART_PREF    = "vp_fanart_on";

let fanartAtivo = localStorage.getItem(FANART_PREF) !== "false";

let fanartCache = {};
try { fanartCache = JSON.parse(localStorage.getItem(FANART_STORE) || "{}"); } catch {}
function saveFanart(artistId, dados) {
  fanartCache[artistId] = { ...(fanartCache[artistId] || {}), ...dados };
  try { localStorage.setItem(FANART_STORE, JSON.stringify(fanartCache)); } catch {}
}

async function mbidDoArtista(artistId, nome) {
  const hit = fanartCache[artistId];
  if (hit && "mbid" in hit) return hit.mbid;
  const url = "https://musicbrainz.org/ws/2/artist/?fmt=json&limit=1&query="
            + encodeURIComponent(nome);
  const r = await fetch(url);
  if (!r.ok) throw new Error("musicbrainz " + r.status);
  const d = await r.json();
  const mbid = d.artists?.[0]?.id || null;
  saveFanart(artistId, { mbid });
  return mbid;
}

async function imagensDaFanart(artistId, nome) {
  const hit = fanartCache[artistId];
  if (hit && hit.urls) return hit.urls;
  const mbid = await mbidDoArtista(artistId, nome);
  if (!mbid) return [];
  const params = new URLSearchParams({ api_key: FANART_PROJETO });
  const r = await fetch(`https://webservice.fanart.tv/v3/music/${mbid}?${params}`);
  if (r.status === 404) { saveFanart(artistId, { urls: [] }); return []; }
  if (!r.ok) throw new Error("fanart " + r.status);
  const d = await r.json();
  const urls = [...(d.artistthumb || []), ...(d.artistbackground || [])].map(x => x.url);
  saveFanart(artistId, { urls });
  return urls;
}

let fanartRun = { chave: null, tentativas: 0, encerrado: false };
let fanartOcupado = false;

async function buscarImagensDoArtista(artistId, nome) {
  if (!fanartAtivo) return;
  if (el.wrap.dataset.view !== "capa") return;
  if (!artistId || !nome) return;

  const emCache = fanartCache[artistId];
  if (emCache?.urls) {
    if (emCache.urls.length && slidesFor !== artistId) startArtistSlides(emCache.urls, artistId);
    return;
  }

  const chave = artistId + "|" + (cur.albumId || "");
  if (chave !== fanartRun.chave) {
    fanartRun = { chave, tentativas: 0, encerrado: false };
  }
  if (fanartRun.encerrado || fanartOcupado) return;

  fanartRun.tentativas++;
  fanartOcupado = true;
  try {
    const urls = await imagensDaFanart(artistId, nome);
    fanartRun.encerrado = true;
    if (urls.length) startArtistSlides(urls, artistId);
  } catch {
    if (fanartRun.tentativas >= FANART_TRIES) fanartRun.encerrado = true;
  } finally {
    fanartOcupado = false;
  }
}

const SLIDE_MS = 15000;
const SLIDE_POS = "vp_slide_pos";
let slides = [], slideTimer = null;
let slidesFor = null;

let slidePos = Number(localStorage.getItem(SLIDE_POS)) || 0;

function proximoSlide() {
  slidePos = (slidePos + 1) % 1e6;
  try { localStorage.setItem(SLIDE_POS, slidePos); } catch {}
  return slides[slidePos % slides.length];
}

function stopArtistSlides() {
  clearInterval(slideTimer);
  slideTimer = null;
  slides = [];
  slidesFor = null;
}

function startArtistSlides(urls, artistId) {
  stopArtistSlides();
  if (!urls.length) return;
  slides = urls;
  slidesFor = artistId;

  const troca = () => {
    if (el.wrap.dataset.view !== "capa" || el.wrap.dataset.state !== "playing") return;
    artistUrl = proximoSlide();
    showArtistImage(artistUrl);
  };

  if (urls.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    slideTimer = setTimeout(troca, SLIDE_MS);
    return;
  }
  slideTimer = setInterval(troca, SLIDE_MS);
}

// visualizacao: "vinil" (default) ou "capa". animate=true faz o crossfade.
function setView(v, animate) {
  v = v === "capa" ? "capa" : "vinil";
  try { localStorage.setItem("view_mode", v); } catch {}
  const swap = () => {
    el.wrap.dataset.view = v;
    el.bg.classList.toggle("bg--immersive", v === "capa");
    el.viewtoggle.setAttribute("aria-label",
      v === "capa" ? "Ver como vinil" : "Ver como capa");
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!animate || reduce || el.wrap.dataset.view === v) { swap(); return; }
  el.stage.classList.add("switching");
  setTimeout(() => {
    swap();
    requestAnimationFrame(() => el.stage.classList.remove("switching"));
  }, 170);
}

// ---- PKCE ----
const rand = n => {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  const cs = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  return [...a].map(x => cs[x % 64]).join("");
};
async function challenge(v) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return btoa(String.fromCharCode(...new Uint8Array(h)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function login() {
  const verifier = rand(64);
  localStorage.setItem("pkce_verifier", verifier);
  const p = new URLSearchParams({
    client_id: CLIENT_ID, response_type: "code", redirect_uri: REDIRECT,
    scope: SCOPE, code_challenge_method: "S256",
    code_challenge: await challenge(verifier),
  });
  location.href = "https://accounts.spotify.com/authorize?" + p;
}
async function tokenRequest(body) {
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) {
    const e = new Error(t.error || "token_request_failed");
    e.tokenFail = true;
    throw e;                       // NAO grava expires_at num pedido que falhou
  }
  localStorage.setItem("access_token", t.access_token);
  if (t.refresh_token) localStorage.setItem("refresh_token", t.refresh_token);
  localStorage.setItem("expires_at", Date.now() + (t.expires_in ?? 3600) * 1000);
}
const exchange = code => tokenRequest({
  client_id: CLIENT_ID, grant_type: "authorization_code",
  code, redirect_uri: REDIRECT,
  code_verifier: localStorage.getItem("pkce_verifier"),
});
const refresh = () => tokenRequest({
  client_id: CLIENT_ID, grant_type: "refresh_token",
  refresh_token: localStorage.getItem("refresh_token"),
});

class ApiError extends Error {
  constructor(kind, status) { super(kind); this.kind = kind; this.status = status; }
}

// sessao morta: limpa e volta pra tela de conexao com aviso
function sessionExpired() {
  ["access_token", "refresh_token", "expires_at"].forEach(k => localStorage.removeItem(k));
  setState("auth", "Sessão expirada. Conecte de novo.");
}

// serializa o refresh: o PKCE rotaciona o refresh_token a cada uso, entao dois
// refreshes concorrentes (ex: chamadas de artista + album no mesmo tick) fariam o
// segundo bater com um refresh_token ja consumido pelo primeiro e derrubar a sessao
// boa. Todo mundo espera a MESMA promise em vez de disparar a sua.
let refreshPromise = null;
function tryRefresh() {
  if (!refreshPromise) {
    refreshPromise = refresh()
      .then(() => true)
      .catch(() => { sessionExpired(); return false; })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function api(url, opts = {}, retried = false) {
  const exp = +localStorage.getItem("expires_at");
  if (!exp || Date.now() > exp - 60000) {
    if (!await tryRefresh()) throw new ApiError("auth", 401);
  }
  const r = await fetch(url, {
    ...opts,
    headers: { Authorization: "Bearer " + localStorage.getItem("access_token"), ...(opts.headers || {}) },
  });
  if (r.status === 401) {
    if (retried) { sessionExpired(); throw new ApiError("auth", 401); }
    if (!await tryRefresh()) throw new ApiError("auth", 401);
    return api(url, opts, true);
  }
  if (r.status === 204) return null;
  if (r.status === 404) throw new ApiError("no_device", 404);
  if (r.status === 403) throw new ApiError("premium", 403);
  if (r.status === 429) {
    const ra = parseInt(r.headers.get("Retry-After") || "", 10);
    const e = new ApiError("rate", 429);
    e.retryAfter = Number.isFinite(ra) ? ra : 0;
    throw e;
  }
  if (!r.ok) throw new ApiError("http", r.status);
  const ct = r.headers.get("content-type") || "";
  return ct.includes("json") ? r.json() : null;
}

// ---- estado local ----
let cur = { isPlaying: false, progressMs: 0, durationMs: 0, sync: 0, trackId: null, albumId: null,
            artistId: null, artistName: "" };
let album = { id: null, uri: null, tracks: [], failedAt: 0 };
const ALBUM_RETRY_MS = 30000;   // quanto uma falha de album fica valendo antes de tentar de novo
// play/pausa otimista: segura o valor ate a API confirmar, sem piscar
let pending = null; // { value: boolean, until: number }
let firstTick = true;

function reflectPlaying() {
  el.disc.classList.toggle("is-playing", cur.isPlaying);
  el.wrap.dataset.playing = String(cur.isPlaying);
  el.main.textContent = cur.isPlaying ? "pause" : "play";
  el.main.setAttribute("aria-label", cur.isPlaying ? "Pausar" : "Tocar");
}

// o que a lista <ol> esta mostrando agora. Sem isso, o tick reconstruia o DOM
// inteiro a cada 5s - jogava fora foco de teclado e hover de quem estivesse
// navegando a lista.
let rendered = { albumId: null, trackId: null };

// so move o aria-current de lugar, sem tocar no resto da lista
function markCurrentTrack(trackId) {
  el.tracks.querySelectorAll(".trk").forEach(b => {
    if (trackId && b.dataset.id === trackId) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
  });
}

function renderTracks(items, currentId) {
  el.tracks.replaceChildren();
  items.forEach((t, i) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "trk";
    b.dataset.id = t.id || "";
    b.setAttribute("aria-label", "Tocar " + t.name);
    if (t.id === currentId) b.setAttribute("aria-current", "true");
    const n = document.createElement("span");
    n.className = "trk__n";
    n.textContent = String(i + 1).padStart(2, "0");
    const tt = document.createElement("span");
    tt.className = "trk__t";
    tt.textContent = t.name;
    const d = document.createElement("span");
    d.className = "trk__d";
    d.textContent = fmt(t.duration_ms);
    b.append(n, tt, d);
    b.addEventListener("click", () => playAlbumAt(i));
    li.append(b);
    el.tracks.append(li);
  });
}

async function loadAlbum(id) {
  if (!id) return [];
  // cache por id, com uma ressalva: falha nao vira cache permanente. Antes, um
  // GET que falhasse gravava a lista vazia sob esse id e o early return devolvia
  // ela pra sempre - a lista de faixas (e o context_uri do clique) so voltavam
  // a funcionar trocando de album. Agora a falha vale por ALBUM_RETRY_MS e
  // depois tenta de novo, sem insistir a cada tick de 5s (o que so renderia 429).
  const cached = id === album.id
    && (!album.failedAt || Date.now() - album.failedAt < ALBUM_RETRY_MS);
  if (cached) return album.tracks;
  try {
    const a = await api("https://api.spotify.com/v1/albums/" + id + "?limit=50");
    album = {
      id,
      uri: a.uri,
      tracks: a.tracks.items.map(t => ({ id: t.id, name: t.name, duration_ms: t.duration_ms, uri: t.uri })),
      failedAt: 0,
    };
  } catch {
    album = { id, uri: null, tracks: [], failedAt: Date.now() };
  }
  return album.tracks;
}

function showControlErr(e) {
  el.hint.textContent =
    e?.kind === "no_device" ? "Abra o Spotify em algum aparelho." :
    e?.kind === "premium"   ? "Controle exige conta Premium." :
    e?.kind === "rate"      ? "Muitos comandos seguidos, espere um instante." :
                              "Não deu para enviar o comando.";
}
async function sendControl(fn, okResync = true) {
  el.hint.textContent = "";
  try {
    await fn();
  } catch (e) {
    showControlErr(e);
    pending = null;            // comando falhou: volta pro que a API disser
    setTimeout(tick, 200);
    return;
  }
  if (okResync) setTimeout(tick, 350);
}
const prev = () => sendControl(() => api("https://api.spotify.com/v1/me/player/previous", { method: "POST" }));
const next = () => sendControl(() => api("https://api.spotify.com/v1/me/player/next", { method: "POST" }));

// ---- play/pausa no tempo da agulha ----
// O som nao e mais "amaciado" por fade de volume (o player nao mexe mais no
// volume do device em momento nenhum). Quem da o ritmo agora e o movimento da
// agulha: ela desce, encosta no sulco, e SO ENTAO o play acontece; no pause, o
// disco para e a agulha sobe antes do comando sair. Os tempos abaixo sao os
// mesmos das transicoes do CSS em .tonearm.
const delay = ms => new Promise(r => setTimeout(r, ms));
const ARM_DOWN_MS = 1000;   // .tonearm: transition 1s (descida amortecida)
const ARM_UP_MS   = 600;    // [data-playing="false"] .tonearm: 0.6s ease-in
let armMoving = false;

async function toggle() {
  if (armMoving) return;
  const willPlay = !cur.isPlaying;
  armMoving = true;
  cur.isPlaying = willPlay;                        // efeito imediato no disco/botao
  cur.sync = Date.now();
  pending = { value: willPlay, until: Date.now() + 6000 };
  el.hint.textContent = "";
  // sem animacao, nao ha agulha pra esperar
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    if (willPlay) {
      el.disc.classList.add("is-playing");
      el.wrap.dataset.playing = "true";            // desce a agulha
      el.main.textContent = "pause";
      el.main.setAttribute("aria-label", "Pausar");
      await delay(reduce ? 0 : ARM_DOWN_MS);       // toca quando ela encosta no vinil
      try {
        await api("https://api.spotify.com/v1/me/player/play", { method: "PUT" });
      } catch (e) { showControlErr(e); }
    } else {
      el.disc.classList.remove("is-playing");      // disco para
      el.wrap.dataset.playing = "false";           // agulha sobe
      el.main.textContent = "play";
      el.main.setAttribute("aria-label", "Tocar");
      await delay(reduce ? 0 : ARM_UP_MS);         // pausa quando ela termina de subir
      try {
        await api("https://api.spotify.com/v1/me/player/pause", { method: "PUT" });
      } catch (e) { showControlErr(e); }
    }
  } finally {
    armMoving = false;
    if (pending) pending.until = Date.now() + 3500;
    setTimeout(tick, 900);
  }
}
function playAlbumAt(i) {
  const track = album.tracks[i];
  // album.uri e null quando o GET do album falhou (ver loadAlbum). Nesse caso da
  // pra tocar a faixa solta pela uri dela; sem nenhuma das duas nao ha o que
  // enviar - antes isso virava um context_uri: null na requisicao.
  const body = album.uri ? { context_uri: album.uri, offset: { position: i } }
             : track?.uri ? { uris: [track.uri] }
             : null;
  if (!body) { el.hint.textContent = "Não deu para tocar essa faixa."; return; }
  sendControl(() => api("https://api.spotify.com/v1/me/player/play", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

// rate limit: para de bater na API ate a janela passar
let backoffUntil = 0;
// uma tick por vez: o setInterval de 5s e os setTimeout(tick) dos controles
// podiam rodar concorrentes e gravar `cur` fora de ordem (a resposta mais lenta
// chegando por ultimo e sobrescrevendo a mais nova).
let ticking = false;
// se o aviso de conexao esta na tela agora - so ele pode ser limpo no sucesso,
// pra nao apagar um aviso de controle ("abra o Spotify em algum aparelho").
let offlineHint = false;

async function tick() {
  if (ticking || armMoving || Date.now() < backoffUntil) return;  // nao mexe na tela no meio do movimento da agulha
  if (el.wrap.dataset.state === "auth") return;                // deslogado: nao adianta pedir
  ticking = true;
  try { await tickOnce(); } finally { ticking = false; }
}

// o polling so roda com a aba visivel: em background ninguem esta vendo a tela,
// e cada tick e uma requisicao a toa (quota da API e bateria). Ao voltar pra
// aba, ressincroniza na hora em vez de esperar o proximo intervalo.
let pollId = null;
function syncPolling() {
  clearInterval(pollId);
  pollId = null;
  if (document.hidden) return;
  tick();
  pollId = setInterval(tick, 5000);
}
document.addEventListener("visibilitychange", syncPolling);

async function tickOnce() {
  let d;
  try {
    d = await api("https://api.spotify.com/v1/me/player/currently-playing");
  } catch (e) {
    if (e.kind === "auth") return;                    // sessionExpired ja tratou
    if (e.kind === "rate") {
      backoffUntil = Date.now() + ((e.retryAfter || 8) * 1000) + 500;
      return;                                         // nao mexe na tela
    }
    if (e.status === 401 || e.kind === "premium") { forceAuth(); return; }
    // queda de rede com cenario ja na tela: mantem o que esta ali e avisa
    // discreto, em vez de trocar o album inteiro por uma tela de erro.
    if (el.wrap.dataset.state === "playing") {
      el.hint.textContent = "Sem conexão com o Spotify. Tentando de novo…";
      offlineHint = true;
      return;
    }
    setState("error", "Sem conexão com o Spotify.");
    return;
  }
  if (offlineHint) { el.hint.textContent = ""; offlineHint = false; }

  if (!d || !d.item) {
    cur.isPlaying = false;
    el.disc.classList.remove("is-playing");
    el.wrap.dataset.playing = "false";
    firstTick = false;
    if (snapshot && snapshot.coverUrl) {
      // parou a reproducao (ex: no celular): mantem o cenario, pausado
      renderSnapshot(snapshot);
      setState("playing");
      el.wrap.dataset.playing = "false";
    } else {
      // nunca tocou nada nesta sessao/navegador
      el.wrap.dataset.hasCover = "false";
      el.wrap.dataset.hasArtist = "false";
      el.sleeveImg.removeAttribute("src"); el.sleeveImg.alt = "";
      el.sleeveImg.dataset.src = "";
      el.sleeveImg.dataset.albumId = "";
      el.labelImg.hidden = true;
      el.labelImg.dataset.src = "";
      if (el.title.textContent !== "Nada tocando agora") el.title.textContent = "Nada tocando agora";
      el.topAlbum.textContent = "";
      el.topArtist.textContent = "";
      setBg("");
      setArtistPhoto("");
      setState("idle");
    }
    return;
  }

  const it = d.item;
  const names = it.artists ? it.artists.map(a => a.name).join(", ") : (it.show ? it.show.name : "");
  const albumName = it.album?.name ?? it.show?.name ?? "";
  const albumReleaseDate = it.album?.release_date ?? "";
  const img = it.album?.images?.[0]?.url ?? it.images?.[0]?.url ?? "";

  if (el.sleeveImg.dataset.src !== img) {
    const albumId = it.album?.id ?? "";
    // gira so quando muda de album (ja tinha capa e nao e a primeira pintura)
    const spin = !firstTick && !!el.sleeveImg.dataset.src
      && !!albumId && el.sleeveImg.dataset.albumId !== albumId;
    el.sleeveImg.dataset.src = img;
    el.sleeveImg.dataset.albumId = albumId;
    el.labelImg.dataset.src = img;
    applyCover(img, albumName, albumId, spin);
  }
  // topo: artista (serif grande) > album (mono medio). Embaixo do vinil
  // (now__title), destaque e so a musica.
  if (el.title.textContent !== it.name) el.title.textContent = it.name;
  if (el.topArtist.textContent !== names) el.topArtist.textContent = names;
  const albumText = albumLabel(albumName, albumReleaseDate);
  if (el.topAlbum.textContent !== albumText) el.topAlbum.textContent = albumText;
  setBg(img);
  const artistId = it.artists?.[0]?.id || "";
  const artistName = it.artists?.[0]?.name || "";
  const trocouFaixa = cur.trackId && cur.trackId !== it.id;
  if (trocouFaixa || (slidesFor && slidesFor !== artistId)) {
    stopArtistSlides();
    artistUrl = "";
  }
  if (artistId) {
    artistImage(artistId).then(url => {
      if (!artistUrl) setArtistPhoto(url);
      if (snapshot && snapshot.trackId === it.id) { snapshot.artistPhotoUrl = url; persistSnapshot(); }
    });
  } else {
    setArtistPhoto("");
  }

  let playing = d.is_playing;
  if (pending) {
    if (playing === pending.value) pending = null;           // API confirmou
    else if (Date.now() < pending.until) playing = pending.value; // ainda propagando: mantem
    else pending = null;                                     // deu o tempo: aceita a API
  }

  cur = {
    isPlaying: playing,
    progressMs: d.progress_ms ?? 0,
    durationMs: it.duration_ms ?? 0,
    sync: Date.now(),
    trackId: it.id,
    albumId: it.album?.id ?? null,
    artistId,
    artistName,
  };
  reflectPlaying();
  setState("playing");

  buscarImagensDoArtista(artistId, artistName);

  // guarda o cenario completo pro reload / pausa no celular
  snapshot = {
    trackId: it.id,
    trackName: it.name,
    artistNames: names,
    artistId,
    artistName,
    albumName,
    albumReleaseDate,
    albumId: it.album?.id || "",
    coverUrl: img,
    artistPhotoUrl: artistImgCache.id === artistId ? artistImgCache.url : (snapshot?.trackId === it.id ? snapshot.artistPhotoUrl : ""),
    durationMs: it.duration_ms || 0,
    progressMs: d.progress_ms || 0,
    savedAt: Date.now(),
  };
  persistSnapshot();

  firstTick = false;

  // a lista de faixas so existe no modo vinil - no modo capa ela esta escondida
  // por CSS, entao nem vale gastar uma requisicao buscando o album.
  if (cur.albumId && el.wrap.dataset.view !== "capa") {
    const tracks = await loadAlbum(cur.albumId);
    if (tracks.length) {
      // redesenha so quando muda de album; dentro do mesmo album, trocar de
      // faixa e so mover o aria-current.
      if (rendered.albumId !== cur.albumId) {
        renderTracks(tracks, cur.trackId);
      } else if (rendered.trackId !== cur.trackId) {
        markCurrentTrack(cur.trackId);
      }
      rendered = { albumId: cur.albumId, trackId: cur.trackId };
    }
    el.tracks.hidden = !tracks.length;
  } else {
    el.tracks.hidden = true;
    rendered = { albumId: null, trackId: null };
  }
}

// ---- eventos ----
el.prev.addEventListener("click", prev);
el.next.addEventListener("click", next);
el.main.addEventListener("click", toggle);
el.retry.addEventListener("click", () => { setState("loading", "Carregando…"); tick(); });
el.connectBtn.addEventListener("click", login);
el.disconnect.addEventListener("click", forceAuth);

// troca de visualizacao
setView(localStorage.getItem("view_mode") || "vinil");
el.viewtoggle.addEventListener("click", () => {
  const v = el.wrap.dataset.view === "capa" ? "vinil" : "capa";
  setView(v, true);
  if (v === "vinil") tick();
  else buscarImagensDoArtista(cur.artistId, cur.artistName);
});

// tela cheia
function syncFs() {
  const on = !!document.fullscreenElement;
  el.wrap.dataset.fs = on ? "on" : "off";
  el.fs.setAttribute("aria-label", on ? "Sair da tela cheia" : "Tela cheia");
}
el.fs.addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
});
document.addEventListener("fullscreenchange", syncFs);
syncFs();

el.cfg.addEventListener("click", () => {
  el.cfgFanart.checked = fanartAtivo;
  el.cfgModal.showModal();
});

el.cfgModal.addEventListener("close", () => {
  if (el.cfgModal.returnValue !== "salvar") return;
  if (el.cfgFanart.checked === fanartAtivo) return;
  fanartAtivo = el.cfgFanart.checked;
  try { localStorage.setItem(FANART_PREF, fanartAtivo); } catch {}
  if (fanartAtivo) {
    fanartRun = { chave: null, tentativas: 0, encerrado: false };
    buscarImagensDoArtista(cur.artistId, cur.artistName);
  } else {
    stopArtistSlides();
    artistUrl = "";
    setArtistPhoto(artistImgCache.url || "");
  }
});

// atalho: espaco = play/pausa
document.addEventListener("keydown", e => {
  if (e.code !== "Space" && e.key !== " ") return;
  if (e.target.closest("button, a, input, select, textarea")) return; // deixa o foco agir
  if (el.wrap.dataset.state !== "playing") return;
  e.preventDefault();
  toggle();
});

// ---- boot ----
if (localStorage.getItem("scope_v") !== SCOPE_V) {
  ["access_token", "refresh_token", "expires_at"].forEach(k => localStorage.removeItem(k));
  localStorage.setItem("scope_v", SCOPE_V);
}
// cenario da ultima sessao: pinta na hora, pausado, com todos os dados
try {
  snapshot = JSON.parse(localStorage.getItem("vp_snapshot") || "null");
} catch { snapshot = null; }
if (snapshot && snapshot.coverUrl && localStorage.getItem("access_token")) {
  renderSnapshot(snapshot);
  setState("playing");
  el.wrap.dataset.playing = "false";
}
(async () => {
  const code = new URLSearchParams(location.search).get("code");
  if (code) {
    try { await exchange(code); } catch {}
    history.replaceState({}, "", REDIRECT);
  }
  if (!localStorage.getItem("access_token")) { setState("auth"); return; }
  if (!(snapshot && snapshot.coverUrl)) setState("loading", "Carregando…");
  syncPolling();   // tick imediato + intervalo, se a aba estiver visivel
})();
