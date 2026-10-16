# Layouts

Single page app shell: sticky `.topbar` (brand, Local pill, status pill, timer), `.layout` grid (transcript `main` + `.sidebar` aside with speakers and settings), fixed bottom `.dock` (level meter, record button, export).

## mvp/static/index.html
```html
<!doctype html>
<html lang="ca">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Transcriptor</title>
  <link rel="stylesheet" href="/static/styles.css">
</head>
<body>
  <a class="skip-link" href="#transcript">Vés a la transcripció</a>

  <header class="topbar">
    <div class="brand">
      <svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>
      <h1>Transcriptor</h1>
    </div>
    <div class="status">
      <span class="pill pill-local" title="L'àudio es processa en aquest ordinador i no s'envia a cap servidor extern">
        <svg class="icon icon-sm" aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Local
      </span>
      <span id="state" class="pill" role="status" aria-live="polite">Preparat</span>
      <time id="timer" class="timer" aria-label="Temps de gravació">00:00</time>
    </div>
  </header>

  <div class="layout">
    <main id="transcript" class="transcript" tabindex="-1" aria-label="Transcripció">
      <div id="empty" class="empty">
        <svg class="icon icon-lg" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>
        <h2>Comença a parlar</h2>
        <p>Prem <strong>Gravar</strong> i la transcripció apareixerà aquí en directe, separada per parlants.</p>
        <p class="hint">Abans de gravar una reunió, demana el consentiment de tots els participants.</p>
      </div>
      <ol id="utterances" class="utterances"></ol>
      <p id="partial" class="partial" aria-live="off" hidden></p>
    </main>

    <aside class="sidebar">
      <section aria-labelledby="speakers-title">
        <h2 id="speakers-title" class="section-title">Parlants</h2>
        <p id="speakers-empty" class="muted">Apareixeran quan algú parli.</p>
        <ul id="speakers" class="speakers"></ul>
      </section>

      <section aria-labelledby="settings-title">
        <h2 id="settings-title" class="section-title">Configuració</h2>
        <div class="field">
          <label for="device">Micròfon</label>
          <select id="device"><option value="">Per defecte del sistema</option></select>
        </div>
        <div class="field">
          <label for="max-speakers">Nombre màxim de parlants</label>
          <input id="max-speakers" type="number" min="1" max="10" value="5" inputmode="numeric">
        </div>
        <div class="field">
          <label for="threshold">Separació de parlants <output id="threshold-value" for="threshold">0,65</output></label>
          <input id="threshold" type="range" min="0.4" max="0.85" step="0.05" value="0.65" aria-describedby="threshold-help">
          <p id="threshold-help" class="help">Més alt: separa més les veus. Més baix: agrupa més.</p>
        </div>
        <p class="help">La configuració s'aplica en començar una nova gravació.</p>
      </section>
    </aside>
  </div>

  <footer class="dock">
    <div class="meter" aria-hidden="true"><div id="meter-fill" class="meter-fill"></div></div>
    <button id="record" class="btn btn-record" type="button" aria-keyshortcuts="Space">
      <svg class="icon icon-rec" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/></svg>
      <svg class="icon icon-stop" aria-hidden="true" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
      <span id="record-label">Gravar</span>
    </button>
    <button id="export" class="btn btn-secondary" type="button" disabled>
      <svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>
      Exportar
    </button>
    <button id="jump" class="btn btn-ghost jump" type="button" hidden>
      <svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
      Anar al final
    </button>
  </footer>

  <div id="toast" class="toast" role="alert" hidden></div>
  <script src="/static/app.js" type="module"></script>
</body>
</html>

```
