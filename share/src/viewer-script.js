// A meeting shared from Murmur: downloads the encrypted envelope, decrypts it here with the key in
// the link's #fragment (or one derived from the password) and draws it. The text comes already
// translated from Murmur; the strings below are only for what shows before it is decrypted.
// Everything is drawn with textContent: nothing in a meeting is ever read as HTML.

const STRINGS = {
  ca: {
    loading: "Obrint la reunió…",
    notFound: "Aquest enllaç no existeix o ha caducat",
    notFoundHint: "Demana a qui te l'ha enviat que el torni a compartir.",
    noKey: "A l'enllaç li falta una part",
    noKeyHint: "Copia l'enllaç sencer, també el que hi ha després del #.",
    broken: "No s'ha pogut obrir la reunió",
    brokenHint: "L'enllaç no és correcte o el navegador no pot desxifrar-la.",
    locked: "Aquesta reunió té contrasenya",
    lockedHint: "Qui te l'ha compartit te l'hauria d'haver donat a part.",
    password: "Contrasenya",
    open: "Obre",
    opening: "Obrint…",
    wrong: "La contrasenya no és correcta.",
  },
  es: {
    loading: "Abriendo la reunión…",
    notFound: "Este enlace no existe o ha caducado",
    notFoundHint: "Pide a quien te lo ha enviado que lo vuelva a compartir.",
    noKey: "Al enlace le falta una parte",
    noKeyHint: "Copia el enlace entero, también lo que hay después del #.",
    broken: "No se ha podido abrir la reunión",
    brokenHint: "El enlace no es correcto o el navegador no puede descifrarla.",
    locked: "Esta reunión tiene contraseña",
    lockedHint: "Quien te la ha compartido te la debería haber dado aparte.",
    password: "Contraseña",
    open: "Abrir",
    opening: "Abriendo…",
    wrong: "La contraseña no es correcta.",
  },
  en: {
    loading: "Opening the meeting…",
    notFound: "This link doesn't exist or has expired",
    notFoundHint: "Ask whoever sent it to share it again.",
    noKey: "Part of the link is missing",
    noKeyHint: "Copy the whole link, including what comes after the #.",
    broken: "The meeting couldn't be opened",
    brokenHint: "The link isn't right or this browser can't decrypt it.",
    locked: "This meeting has a password",
    lockedHint: "Whoever shared it should have given it to you separately.",
    password: "Password",
    open: "Open",
    opening: "Opening…",
    wrong: "That password isn't right.",
  },
};

const lang = (navigator.languages ?? [navigator.language]).map((l) => l.slice(0, 2)).find((l) => l in STRINGS) ?? "en";
const S = STRINGS[lang];
const app = document.getElementById("app");

// --- Small DOM helpers ---------------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function show(...nodes) {
  app.replaceChildren(...nodes);
}

function message(title, hint, ...extra) {
  document.documentElement.lang = lang;
  show(el("div", { class: "message" }, el("h1", {}, title), hint && el("p", {}, hint), ...extra));
}

// --- Decrypting ----------------------------------------------------------------------------

const fromBase64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function keyFromPassword(password, kdf) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: kdf.hash, salt: fromBase64(kdf.salt), iterations: kdf.iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

/** The meeting's key, kept to decrypt its files (screenshots, audio) when they're asked for. */
let meetingKey = null;

async function open(envelope, key) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(envelope.iv) }, key, fromBase64(envelope.data));
  const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  meetingKey = key;
  return JSON.parse(text);
}

/** One of the meeting's files: 12 bytes of IV, then the encrypted bytes. */
async function file(name) {
  const response = await fetch(`/${location.pathname.slice(1)}/${name}`);
  if (!response.ok) throw new Error(String(response.status));
  const bytes = new Uint8Array(await response.arrayBuffer());
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, meetingKey, bytes.slice(12));
}

async function start() {
  message(S.loading);
  const id = location.pathname.slice(1);
  let envelope;
  try {
    const response = await fetch(`/${id}.json`, { cache: "no-store" });
    if (response.status === 404) return message(S.notFound, S.notFoundHint);
    if (!response.ok) throw new Error(String(response.status));
    envelope = await response.json();
  } catch {
    return message(S.broken, S.brokenHint);
  }

  if (envelope.kdf) return askPassword(envelope);

  const secret = location.hash.slice(1);
  if (!secret) return message(S.noKey, S.noKeyHint);
  try {
    const key = await crypto.subtle.importKey("raw", fromBase64(secret), "AES-GCM", false, ["decrypt"]);
    render(await open(envelope, key));
  } catch {
    message(S.broken, S.brokenHint);
  }
}

function askPassword(envelope) {
  const input = el("input", { id: "password", type: "password", autocomplete: "off", required: true });
  const error = el("p", { class: "error", role: "alert" });
  const button = el("button", { class: "button", type: "submit" }, S.open);
  const form = el("form", { class: "unlock" }, el("label", { for: "password" }, S.password), input, error, button);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    button.disabled = true;
    button.textContent = S.opening;
    error.textContent = "";
    try {
      render(await open(envelope, await keyFromPassword(input.value, envelope.kdf)));
    } catch {
      error.textContent = S.wrong;
      button.disabled = false;
      button.textContent = S.open;
      input.select();
    }
  });
  message(S.locked, S.lockedHint, form);
  input.focus();
}

// --- Drawing the meeting -------------------------------------------------------------------

/** A speaker's colour class: t1…t4, or "you". */
const toneClass = (meeting, speaker) => {
  const tone = meeting.speakers?.[speaker]?.tone;
  return tone === "you" ? "you" : tone ? `t${tone}` : "";
};

const flag = (meeting, speaker, name) => el("span", { class: `flag ${toneClass(meeting, speaker)}` }, name ?? meeting.speakers?.[speaker]?.name ?? "");

/** "1:04:22" → 3862. */
const seconds = (time) => time.split(":").reduce((total, n) => total * 60 + Number(n), 0);

// --- Audio: downloaded and decrypted only when someone wants to listen ---------------------

let audio = null;
let audioLoading = null;

function loadAudio(meeting, bar) {
  audioLoading ??= (async () => {
    const { parts, type } = meeting.files.audio;
    const button = bar.querySelector("button");
    const chunks = [];
    for (let i = 0; i < parts; i++) {
      button.textContent = `${meeting.labels.loadingAudio} ${Math.round((i / parts) * 100)}%`;
      chunks.push(await file(`audio.${i}`));
    }
    audio = el("audio", { controls: true, preload: "auto" });
    audio.src = URL.createObjectURL(new Blob(chunks, { type }));
    bar.replaceChildren(audio);
    return audio;
  })().catch((e) => {
    audioLoading = null;
    bar.querySelector("button").textContent = meeting.labels.audioFailed;
    throw e;
  });
  return audioLoading;
}

/** A minute of the meeting: with the recording shared, it plays from there. */
const at = (time) => {
  if (!time) return null;
  if (!audioBar) return el("span", { class: "at" }, time);
  const button = el("button", { type: "button", class: "at", title: shared.labels.playFrom.replace("{{time}}", time) }, time);
  button.addEventListener("click", async () => {
    const player = audio ?? (await loadAudio(shared, audioBar));
    player.currentTime = seconds(time);
    player.play().catch(() => {});
    audioBar.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  return button;
};

let shared = null;
let audioBar = null;

function screensView(meeting) {
  return [
    el(
      "div",
      { class: "screens" },
      meeting.files.screens.map((shot) => {
        const img = el("img", { alt: shot.alt });
        const link = el("a", { target: "_blank", rel: "noopener" }, img);
        file(shot.file)
          .then((bytes) => {
            const src = URL.createObjectURL(new Blob([bytes], { type: shot.type }));
            img.src = src;
            link.href = src;
          })
          .catch(() => img.replaceWith(el("span", { class: "screen-missing" }, meeting.labels.screenFailed)));
        return el("figure", {}, link, el("figcaption", {}, at(shot.at)));
      }),
    ),
  ];
}

/** Inline text with its marks; links only to the web or mail. */
function runs(list = []) {
  return list.map((r) => {
    if (r.br) return el("br");
    let node = document.createTextNode(r.t ?? "");
    if (r.code) node = el("code", {}, node);
    if (r.b) node = el("strong", {}, node);
    if (r.i) node = el("em", {}, node);
    if (r.u) node = el("u", {}, node);
    if (r.s) node = el("s", {}, node);
    if (r.href && /^(https?:|mailto:)/i.test(r.href)) node = el("a", { href: r.href, rel: "noopener noreferrer nofollow", target: "_blank" }, node);
    return node;
  });
}

function blocks(list = []) {
  return list.map((b) => {
    switch (b.type) {
      case "h":
        return el(`h${Math.min(5, (b.level ?? 1) + 2)}`, {}, runs(b.runs));
      case "p":
        return el("p", {}, at(b.at), runs(b.runs));
      case "quote":
        return el("blockquote", {}, blocks(b.blocks));
      case "ul":
      case "ol":
      case "todo":
        return el(
          b.type === "ol" ? "ol" : "ul",
          { class: b.type === "todo" ? "todo" : undefined },
          (b.items ?? []).map((item) => el("li", { class: item.checked ? "checked" : undefined }, at(item.at), runs(item.runs), blocks(item.children))),
        );
      default:
        return null;
    }
  });
}

function coverView(meeting) {
  const c = meeting.cover;
  const L = meeting.labels;
  const cards = [];
  if (c.tone) {
    cards.push(el("section", { class: "card" }, el("h2", {}, L.tone), el("p", { class: "tone-label" }, c.tone.label), c.tone.reason && el("p", { class: "tone-reason" }, c.tone.reason)));
  }
  if (c.talk?.length) {
    const bar = el("div", { class: "bar", role: "img", "aria-label": c.talk.map((s) => `${s.name} ${s.share}`).join(", ") });
    for (const s of c.talk) {
      const span = el("span", { class: toneClass(meeting, s.speaker) });
      span.style.width = `${s.fraction * 100}%`;
      bar.append(span);
    }
    const legend = el(
      "ul",
      { class: "legend" },
      c.talk.map((s) => el("li", { class: toneClass(meeting, s.speaker) }, el("i", { "aria-hidden": "true" }), el("b", {}, s.name), el("small", {}, `${s.share} · ${s.time}`))),
    );
    cards.push(el("section", { class: `card${c.tone ? "" : " wide"}` }, el("h2", {}, L.talk), bar, legend));
  }

  return [
    c.excerpt && el("p", { class: "excerpt" }, c.excerpt),
    c.note && el("p", { class: "note" }, c.note),
    cards.length > 0 && el("div", { class: "cards" }, cards),
    c.summary?.length > 0 && el("section", {}, el("h2", {}, L.summary), el("ul", { class: "list" }, c.summary.map((s) => el("li", {}, s)))),
    c.decisions?.length > 0 && el("section", {}, el("h2", {}, L.decisions), el("ul", { class: "list" }, c.decisions.map((d) => el("li", {}, at(d.at), d.text)))),
    c.tasks?.length > 0 &&
      el(
        "section",
        {},
        el("h2", {}, L.tasks),
        el(
          "ul",
          { class: "tasks" },
          c.tasks.map((task) =>
            el(
              "li",
              { class: task.done ? "done" : undefined },
              el("span", { class: "check", role: "img", "aria-label": task.done ? L.taskDone : L.taskOpen }),
              el(
                "div",
                {},
                el("div", { class: "task-text" }, task.text),
                (task.owner || task.when || task.at) &&
                  el("div", { class: "task-meta" }, task.owner && (task.speaker != null ? flag(meeting, task.speaker, task.owner) : el("span", { class: "flag" }, task.owner)), task.when, at(task.at)),
              ),
            ),
          ),
        ),
      ),
    c.parts?.length > 0 &&
      el(
        "section",
        {},
        el("h2", {}, L.parts),
        el(
          "ol",
          { class: "parts" },
          c.parts.map((p) => el("li", {}, el("span", { class: "at" }, p.at), el("div", {}, el("h3", {}, p.title), p.points?.length > 0 && el("ul", {}, p.points.map((x) => el("li", {}, x)))))),
        ),
      ),
  ];
}

function transcriptView(meeting) {
  return meeting.transcript.map((u) => el("div", { class: "utterance" }, flag(meeting, u.s), at(u.at), el("p", {}, u.text)));
}

function render(meeting) {
  shared = meeting;
  document.documentElement.lang = meeting.lang ?? lang;
  if (meeting.files?.audio) {
    audioBar = el("div", { class: "audio" }, el("button", { type: "button", class: "listen" }, meeting.labels.listen));
    audioBar.querySelector("button").addEventListener("click", () => loadAudio(meeting, audioBar).then((a) => a.play().catch(() => {})));
  }
  document.title = `${meeting.title} · Murmur`;
  const L = meeting.labels;
  const views = [
    meeting.cover && { id: "cover", label: L.cover, draw: () => coverView(meeting) },
    meeting.notes?.length > 0 && { id: "notes", label: L.notes, draw: () => [el("div", { class: "notes" }, blocks(meeting.notes))] },
    meeting.transcript?.length > 0 && { id: "transcript", label: L.transcript, draw: () => transcriptView(meeting) },
    meeting.files?.screens?.length > 0 && { id: "screens", label: L.screens, draw: () => screensView(meeting) },
  ].filter(Boolean);

  const body = el("div", { id: "view", role: views.length > 1 ? "tabpanel" : undefined });
  const tabs =
    views.length > 1 &&
    el(
      "div",
      { class: "tabs", role: "tablist" },
      views.map((v) =>
        el("button", { type: "button", role: "tab", id: `tab-${v.id}`, "aria-controls": "view", "aria-selected": "false" }, v.label),
      ),
    );
  const select = (v) => {
    for (const b of tabs ? tabs.children : []) b.setAttribute("aria-selected", String(b.id === `tab-${v.id}`));
    body.setAttribute("aria-labelledby", `tab-${v.id}`);
    body.replaceChildren(...v.draw().filter(Boolean));
  };
  if (tabs) [...tabs.children].forEach((b, i) => b.addEventListener("click", () => select(views[i])));

  show(
    el("h1", {}, meeting.title),
    el("div", { class: "meta" }, meeting.meta.join(" · ")),
    meeting.tags?.length > 0 && el("ul", { class: "tags" }, meeting.tags.map((t) => el("li", {}, t))),
    audioBar,
    tabs,
    body,
    el("footer", {}, meeting.footer),
  );
  if (views.length) select(views[0]);
}

start();
