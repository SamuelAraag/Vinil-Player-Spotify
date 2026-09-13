# Vinil-Player-Spotify

Widget web de "tocando agora" do Spotify, interface própria (não é o player embed
oficial), com um disco de vinil girando, braço de toca-discos animado e a capa do
álbum no selo central.

Três arquivos estáticos, **sem build e sem servidor próprio** — é só servir a pasta:

```
index.html   estrutura (~90 linhas)
app.css      estilo, tokens e as duas visualizações
app.js       Spotify (PKCE, polling, controles) e a coreografia da agulha
```

## Conceito

O player foi pensado pra representar a experiência de **ouvir um álbum**, não uma
música solta tocando no shuffle. Por isso a hierarquia visual das informações segue
essa ordem de importância:

1. **Artista** — quem está tocando (serif grande, `.top__artist`).
2. **Álbum** (com o ano de lançamento) — a obra que está girando no disco
   (`.top__album`).
3. **Música** — a faixa específica dentro do álbum, é o dado mais efêmero dos três e
   fica só no título abaixo do vinil (`.now__title`), não repetido no topo.

O disco, o braço e a capa giratória existem pra reforçar essa ideia: o objeto físico
sendo representado é o álbum (o vinil), a música é só a faixa que a agulha está lendo
naquele momento.

## Rodando localmente

Servir de **dentro** da pasta `vinil-player-spotify/` (o Redirect URI cadastrado no
Spotify Developer Dashboard é exato):

```
python3 -m http.server 8080
```

Abre em `http://127.0.0.1:8080/`. App Spotify: **VinilPlayer**, fluxo PKCE (sem client
secret, tudo no front). Escopos: `user-read-currently-playing user-read-playback-state
user-modify-playback-state` (o segundo e o terceiro exigem conta Premium + um device
ativo pra funcionar o controle).

## Mapa de dados: de onde vem cada informação

Referência rápida pra não precisar reler o `app.js` inteiro toda vez. Tudo isso é
`fetch` direto pra API REST do Spotify (`api()` cuida de token/refresh/erros).

| O que aparece na tela | Elemento (seletor) | Requisição | Campo na resposta |
|---|---|---|---|
| Nome do artista | `.top__artist` | `GET /v1/me/player/currently-playing` | `item.artists[].name` (join por vírgula se tiver mais de um) |
| Álbum + ano | `.top__album` | `GET /v1/me/player/currently-playing` | `item.album.name` + `item.album.release_date` (ano = 4 primeiros chars; a API manda com precisão de dia, mês ou só ano) |
| Nome da música | `.now__title` | `GET /v1/me/player/currently-playing` | `item.name` |
| Capa do álbum | `.sleeve__img`, `.disc__label-img`, `.bg` (fundo desfocado) | `GET /v1/me/player/currently-playing` | `item.album.images[0].url` |
| Tocando / pausado, progresso, duração | `data-playing`, braço do toca-discos, disco girando | `GET /v1/me/player/currently-playing` | `is_playing`, `progress_ms`, `item.duration_ms` |
| Foto do artista (modo "capa") | `.artist__img` | `GET /v1/artists/{id}` (id vem de `item.artists[0].id` da currently-playing) | `images[0].url` |
| Lista de faixas do álbum | `.tracks` | `GET /v1/albums/{id}?limit=50` (id = `item.album.id`) | `tracks.items[].name`, `.duration_ms`, `.id` |
| Play / pause / próxima / anterior | botões `.ctrl` | `PUT /v1/me/player/play`, `/pause`, `POST /v1/me/player/next`, `/previous` | sem corpo relevante na resposta, erros por status (`404` sem device, `403` sem Premium, `429` rate limit) |
| Tocar uma faixa específica do álbum | clique num item de `.tracks` | `PUT /v1/me/player/play` com `{ context_uri, offset: { position } }`, ou `{ uris: [...] }` se o álbum não tiver carregado | — |

Funções que fazem essas chamadas: `tick()` (currently-playing; roda a cada 5s **só
com a aba visível**), `artistImage()`, `loadAlbum()` (só no modo vinil, onde a lista
aparece), `sendControl()` (prev/next) e `toggle()` (play/pause).

**O player não mexe no volume.** Não há nenhuma chamada a
`PUT /me/player/volume` nem a `GET /me/player` — o controle de nível fica por conta
do próprio Spotify. O que dá ritmo ao play/pause é o movimento da agulha: no play
ela desce e o comando sai quando encosta no sulco (1000ms); no pause o disco para,
a agulha sobe e só então o comando sai (600ms). Os dois tempos espelham as
transições do `.tonearm` no CSS, e com `prefers-reduced-motion` não há espera.

## Limites conhecidos

App do Spotify criado depois de nov/2024: **sem** audio-features (BPM, energia),
recommendations, related-artists nem preview de 30s.
