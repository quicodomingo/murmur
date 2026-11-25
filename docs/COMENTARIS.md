# Comentaris

«Envia un comentari» deixa dir des de l'app què no va, una idea o qualsevol altra cosa, sense sortir de Murmur. Mockup: [`docs/mockups/comentaris.html`](mockups/comentaris.html).

## Com funciona

- **D'on s'hi arriba:** menú Ajuda › «Envia un comentari…» (al Mac), Configuració › General › Ajuda (a tots els sistemes) i, als avisos d'error, el botó discret «Explica'ns què ha passat», que l'obre amb l'error ja enganxat.
- **La finestra** (`FeedbackDialog.tsx`): el tipus (Alguna cosa no va, Una idea, Una altra cosa), el missatge (de 10 a 5.000 caràcters), el correu opcional per respondre i la casella, desmarcada, «Adjunta el registre de Murmur de les últimes 24 hores», que es pot llegir abans («Mostra'l»). Una línia amb un núvol diu exactament què més s'hi afegeix. ⌘↩ envia.
- **L'app** (`feedback.rs`) ho envia al Worker per HTTPS, només en prémer «Envia». Sense connexió es desa a `feedback-outbox/` (a la carpeta de dades) i s'envia sol el proper cop que s'obre Murmur amb connexió. Si el Worker diu que és massa (429), es torna a provar més endavant; si el refusa, es llença.
- **El Worker** (`feedback/`) ho comprova, ho desa a D1 i ho reenvia per correu amb Cloudflare Email Routing, amb el registre com a fitxer adjunt i, si hi ha correu, com a «Respon a». Límits: 5 missatges per hora des d'una mateixa adreça i 500 al dia en total. L'adreça IP no es desa: només un resum (SHA-256 amb una sal secreta), per comptar-los.

## Què s'envia

- El que l'usuari escriu, el tipus i, si ve d'un error, el text de l'error.
- El correu, només si el posa.
- La versió de l'app, el sistema i la seva versió, l'arquitectura, el model d'ordinador (al Mac, «Mac16,1»), la memòria en GB i la llengua de la interfície.
- El registre de les últimes 24 hores (com a molt 256 KB), només si es marca la casella. El registre (`logfile.rs`) ja no porta mai res de les reunions, ni títols, ni noms, ni el nom dels dispositius, i la carpeta de l'usuari hi surt com a «~».
- Mai res de les reunions: ni títols, ni text, ni notes, ni noms, ni àudio.

## Posar-lo en marxa

Cal un compte de Cloudflare amb un domini que tingui Email Routing actiu (per a l'adreça des d'on surten els correus) i l'adreça on han d'arribar, verificada a Email Routing.

```bash
cd feedback && npm install
cp wrangler.example.toml wrangler.toml       # no es puja al repositori
npx wrangler d1 create murmur-feedback       # l'id va a database_id
# a wrangler.toml: TO_ADDRESS (on arriben) i FROM_DOMAIN (el domini d'Email Routing)
npm run schema                               # la taula, una vegada
npx wrangler secret put SALT                 # qualsevol text llarg i aleatori
npm run deploy
npm test                                     # les comprovacions del missatge i del correu
```

Després, l'adreça del Worker va a `URL_DEFAULT` de `app/src-tauri/src/feedback.rs` (ara, `https://murmur-feedback.quicodomingo.workers.dev`). Sense adreça (forks, compilacions de prova) l'app no ensenya «Envia un comentari». Per provar-ho contra un Worker local: `npx wrangler dev --port 8799` i `MURMUR_FEEDBACK_URL=http://127.0.0.1:8799 cargo test feedback -- --ignored`.

Per llegir-los tots: `npx wrangler d1 execute murmur-feedback --remote --command "SELECT created_at, kind, app, message FROM feedback ORDER BY created_at DESC LIMIT 20"`.

## Al mòbil (pendent)

Un full a Configuració › Ajuda amb els mateixos tres tipus i el mateix Worker (`app: "iphone 1.1"`), sense registre a la primera versió.
