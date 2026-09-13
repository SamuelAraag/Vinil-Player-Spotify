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

Abre em `http://127.0.0.1:8080/`.

## O app no Spotify (onde mexer nas configurações)

Dashboard: **https://developer.spotify.com/dashboard** — logar com a conta dona do app.
Tem um atalho discreto pra cá no rodapé da própria tela do player ("api app spotify").

| | |
|---|---|
| Nome do app | **VinilPlayer** |
| Client ID | `07f8e60ada964056b6600e6f47c00716` — é público, fica no `app.js` |
| Client secret | não tem: o fluxo é **PKCE**, 100% no front |
| Escopos | `user-read-currently-playing`, `user-read-playback-state`, `user-modify-playback-state` |
| Modo | **dev** — só as contas listadas em *User Management* conseguem usar |

### Cadastrar uma rota nova (Redirect URI)

O `app.js` monta o redirect como `location.origin + location.pathname`. Ou seja: **a URL
exata de onde a página é servida**, com a barra final. Toda vez que isso mudar — outra
porta, outra pasta, um deploy — a URL nova precisa ser cadastrada no dashboard, em
*Edit Settings → Redirect URIs*, senão o login falha com `redirect_uri: Not matching
configuration`.

Exemplos do que conta como URL diferente e precisa de cadastro próprio:

```
http://127.0.0.1:8080/                      <- servindo de dentro da pasta
http://127.0.0.1:8080/vinil-player-spotify/ <- servindo da pasta de cima
https://meudominio.com/player/              <- deploy
```

### Mudou escopo? Suba o SCOPE_V

A constante `SCOPE_V` no topo do `app.js` existe pra isso: quando a lista de escopos
muda, subir o número faz o boot limpar os tokens e forçar todo mundo a reconectar. Sem
isso, quem já estava logado continua com um token do escopo antigo e as chamadas novas
falham com 401 — foi exatamente o bug de "desloga sozinho segundos depois de logar".

Nota: `user-read-playback-state` está pedido mas **não é mais usado** — era só do
controle de volume, que saiu. Tirar da lista exige subir o `SCOPE_V`.

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
| Foto do artista (modo "capa") | `.artist__img` | `GET /v1/artists/{id}` (id vem de `item.artists[0].id` da currently-playing) | `images[0].url` (640×640, sempre uma só) |
| Imagens extras do artista (só no modo "capa") | `.artist__img`, em rodízio | `GET musicbrainz.org/ws/2/artist/?query=<nome>` → `GET webservice.fanart.tv/v3/music/{mbid}` | `artists[0].id` (o mbid) → `artistthumb[]` (1000×1000) + `artistbackground[]` (1920×1080) |
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

## Imagens do artista: Spotify primeiro, fanart.tv depois

O Spotify entrega **uma** foto de artista, 640×640. A [fanart.tv](https://fanart.tv)
tem várias (1000×1000) e fundos largos (1920×1080) — mas indexa por **MusicBrainz ID**,
que o Spotify não fornece em lugar nenhum. Daí o caminho em três passos:

```
nome do artista principal  ->  MusicBrainz  ->  mbid  ->  fanart.tv  ->  urls
```

**O fluxo vem ligado**, e é desligado no botão de configurações (o último do canto
direito) → "Ativar fanart com imagens do artista". A escolha fica no `localStorage`
(`vp_fanart_on`), que só guarda `"false"` quando você desliga — ausente vale como ligado.
Desligado, nenhuma das duas APIs é chamada.

Como `localStorage` é por origem, a escolha **não atravessa domínios**: desligar no
`127.0.0.1` não desliga em `samuelaraag.github.io`, e vice-versa.

Regras do fluxo (tudo em `app.js`, seção "imagens extras do artista"):

- **A foto do Spotify entra primeiro e sozinha.** Ela é o piso: aparece na hora e só é
  substituída *se* o caminho acima der certo. Nada disso bloqueia a tela.
- **Só roda na visualização de capa.** No modo vinil o painel do artista nem existe.
- **No máximo 3 tentativas**, uma por tick. Falhou as três, o fluxo encerra e só volta a
  tentar quando **mudar de artista ou de álbum**.
- **Dicionário em `localStorage` (`vp_fanart`)**, indexado pelo id do artista no Spotify
  (estável, ao contrário do nome): guarda o mbid e as urls. Da segunda vez em diante o
  artista não custa requisição nenhuma.
- Com mais de uma imagem, elas entram em **rodízio com crossfade** a cada 30s, em duas
  camadas empilhadas. Com `prefers-reduced-motion`, fica na primeira.

Só o **artista principal** vai pra busca (`item.artists[0].name`) — mandar a lista junta
("Kendrick Lamar, Drake") até funciona por score, mas é sorte, não critério.

Dois cuidados conhecidos: o MusicBrainz **responde 503 com alguma frequência** (foi o que
gastou 2 das 3 tentativas num teste real) e limita requisições por janela; e a busca por
nome é aproximada, então artista de nome ambíguo pode casar errado. Os dois serviços
mandam `access-control-allow-origin: *`, então funcionam direto do navegador, sem proxy.
