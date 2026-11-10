// Sample meetings for the landing screenshots (shoot.mjs), in ca / es / en.
const DAY = 86400e3;
const today10 = (() => { const d = new Date(); d.setHours(10, 0, 0, 0); return d.getTime(); })();

const T = {
  ca: {
    title: "Llançament de la web nova",
    names: ["Marta", "Jordi", "Laia"],
    tags: ["Web", "Estudi Nord"],
    lines: [
      [0, 4, "Bon dia a tothom. Avui la idea és tancar el calendari del llançament i repassar què falta de la web."],
      [1, 12, "Perfecte. Jo he portat les captures de l'última versió, les comparteixo ara."],
      [1, 21, "Com veieu, la portada ja està acabada. Falta la pàgina de preus i revisar els textos en anglès."],
      [2, 33, "Els textos en anglès els tinc gairebé llestos. Me'ls podria mirar algú abans de divendres?"],
      [0, 41, "Sí, els reviso jo. I la pàgina de preus, qui la porta?"],
      [1, 47, "La puc fer yo, pero necesito que me paséis los precios definitivos antes del miércoles."],
      [0, 55, "D'acord. Els preus els tanquem dilluns amb direcció i te'ls passo de seguida."],
      [2, 63, "Una cosa: el formulari de contacte encara envia els correus a l'adreça antiga."],
      [1, 70, "Bona observació. Ho canvio avui mateix, és un minut."],
      [0, 78, "Llavors, si tot va bé, publiquem el dimarts 18 al matí?"],
      [2, 84, "Per mi sí. Prepararé l'anunci per a les xarxes perquè surti el mateix dia."],
      [1, 91, "I jo deixaré la versió antiga desada, per si hem de tornar enrere."],
    ],
    notes: {
      h: "Llançament · dimarts 18",
      p: "Portada acabada. Falten preus i textos en anglès.",
      items: ["Preus definitius abans de dimecres", "Revisar els textos en anglès"],
      indent: "La Marta els revisa abans de divendres",
      tasks: [["Canviar l'adreça del formulari", true], ["Anunci a les xarxes", false]],
    },
    cover: {
      excerpt: "L'equip tanca el calendari: la web nova es publica el dimarts 18 al matí, amb els preus i els textos en anglès acabats abans.",
      tone: { label: "constructive", reason: "Tothom proposa solucions i es reparteix la feina sense discussions." },
      summary: [
        "La portada ja està acabada; falten la pàgina de preus i els textos en anglès.",
        "Els preus definitius es tanquen dilluns amb direcció.",
        "El formulari de contacte encara envia els correus a l'adreça antiga.",
        "Es guarda la versió antiga per poder tornar enrere.",
      ],
      decisions: [
        { text: "Publicar la web nova el dimarts 18 al matí.", t: 78 },
        { text: "La Marta revisa els textos en anglès abans de divendres.", t: 41 },
      ],
      tasks: [
        { text: "Fer la pàgina de preus", owner: "Jordi", when: "dimecres", t: 47 },
        { text: "Passar els preus definitius", owner: "Marta", when: "dilluns", t: 55 },
        { text: "Canviar l'adreça del formulari de contacte", owner: "Jordi", when: "avui", t: 70, done: true },
        { text: "Preparar l'anunci per a les xarxes", owner: "Laia", when: "dimarts 18", t: 84 },
      ],
      parts: [
        { t: 4, title: "Estat de la web", points: ["Portada acabada", "Falten preus i textos en anglès"] },
        { t: 55, title: "Preus i formulari", points: ["Preus tancats dilluns", "Formulari amb l'adreça antiga"] },
        { t: 78, title: "Data de publicació", points: ["Dimarts 18 al matí", "Anunci el mateix dia"] },
      ],
    },
    others: [
      ["Seguiment setmanal", 0.2, ["Estudi Nord"]],
      ["Entrevista amb la Núria", 1, []],
      ["Pressupost 2027", 1.3, ["Direcció"]],
      ["Reunió amb el banc", 3, []],
      ["Formació del CRM", 6, ["Estudi Nord"]],
    ],
    slides: [
      ["Web nova", "Calendari de llançament", ["Portada ✓", "Preus", "Textos en anglès", "Publicació: dimarts 18"]],
      ["Pàgina de preus", "Tres plans", ["Bàsic", "Equip", "Empresa"]],
    ],
    search: "preus",
  },
  es: {
    title: "Lanzamiento de la nueva web",
    names: ["Marta", "Jordi", "Laia"],
    tags: ["Web", "Estudio Norte"],
    lines: [
      [0, 4, "Buenos días a todos. Hoy la idea es cerrar el calendario del lanzamiento y repasar qué falta de la web."],
      [1, 12, "Perfecto. He traído las capturas de la última versión, las comparto ahora."],
      [1, 21, "Como veis, la portada ya está terminada. Falta la página de precios y revisar los textos en inglés."],
      [2, 33, "Los textos en inglés los tengo casi listos. ¿Me los podría mirar alguien antes del viernes?"],
      [0, 41, "Sí, los reviso yo. Y la página de precios, ¿quién la lleva?"],
      [1, 47, "Me la quedo jo, però necessito els preus definitius abans de dimecres."],
      [0, 55, "Vale. Los precios los cerramos el lunes con dirección y te los paso enseguida."],
      [2, 63, "Una cosa: el formulario de contacto todavía envía los correos a la dirección antigua."],
      [1, 70, "Bien visto. Lo cambio hoy mismo, es un minuto."],
      [0, 78, "Entonces, si todo va bien, ¿publicamos el martes 18 por la mañana?"],
      [2, 84, "Por mí sí. Prepararé el anuncio para redes para que salga el mismo día."],
      [1, 91, "Y yo dejaré guardada la versión antigua, por si hay que volver atrás."],
    ],
    notes: {
      h: "Lanzamiento · martes 18",
      p: "Portada terminada. Faltan precios y textos en inglés.",
      items: ["Precios definitivos antes del miércoles", "Revisar los textos en inglés"],
      indent: "Marta los revisa antes del viernes",
      tasks: [["Cambiar la dirección del formulario", true], ["Anuncio en redes", false]],
    },
    cover: {
      excerpt: "El equipo cierra el calendario: la nueva web se publica el martes 18 por la mañana, con los precios y los textos en inglés terminados antes.",
      tone: { label: "constructive", reason: "Todos proponen soluciones y se reparten el trabajo sin discusiones." },
      summary: [
        "La portada ya está terminada; faltan la página de precios y los textos en inglés.",
        "Los precios definitivos se cierran el lunes con dirección.",
        "El formulario de contacto todavía envía los correos a la dirección antigua.",
        "Se guarda la versión antigua para poder volver atrás.",
      ],
      decisions: [
        { text: "Publicar la nueva web el martes 18 por la mañana.", t: 78 },
        { text: "Marta revisa los textos en inglés antes del viernes.", t: 41 },
      ],
      tasks: [
        { text: "Hacer la página de precios", owner: "Jordi", when: "miércoles", t: 47 },
        { text: "Pasar los precios definitivos", owner: "Marta", when: "lunes", t: 55 },
        { text: "Cambiar la dirección del formulario de contacto", owner: "Jordi", when: "hoy", t: 70, done: true },
        { text: "Preparar el anuncio para redes", owner: "Laia", when: "martes 18", t: 84 },
      ],
      parts: [
        { t: 4, title: "Estado de la web", points: ["Portada terminada", "Faltan precios y textos en inglés"] },
        { t: 55, title: "Precios y formulario", points: ["Precios cerrados el lunes", "Formulario con la dirección antigua"] },
        { t: 78, title: "Fecha de publicación", points: ["Martes 18 por la mañana", "Anuncio el mismo día"] },
      ],
    },
    others: [
      ["Seguimiento semanal", 0.2, ["Estudio Norte"]],
      ["Entrevista con Núria", 1, []],
      ["Presupuesto 2027", 1.3, ["Dirección"]],
      ["Reunión con el banco", 3, []],
      ["Formación del CRM", 6, ["Estudio Norte"]],
    ],
    slides: [
      ["Nueva web", "Calendario de lanzamiento", ["Portada ✓", "Precios", "Textos en inglés", "Publicación: martes 18"]],
      ["Página de precios", "Tres planes", ["Básico", "Equipo", "Empresa"]],
    ],
    search: "precios",
  },
  en: {
    title: "New website launch",
    names: ["Marta", "Jordi", "Laia"],
    tags: ["Website", "North Studio"],
    lines: [
      [0, 4, "Morning, everyone. Today the idea is to settle the launch date and go over what's left on the website."],
      [1, 12, "Great. I've brought screenshots of the latest version, sharing them now."],
      [1, 21, "As you can see, the home page is done. We still need the pricing page and to review the English copy."],
      [2, 33, "The English copy is almost ready. Could someone look it over before Friday?"],
      [0, 41, "Yes, I'll review it. And who's taking the pricing page?"],
      [1, 47, "I can do it, but I need the final prices before Wednesday."],
      [0, 55, "OK. We'll agree on prices with management on Monday and I'll send them straight over."],
      [2, 63, "One thing: the contact form still sends emails to the old address."],
      [1, 70, "Good catch. I'll change it today, it takes a minute."],
      [0, 78, "So, if all goes well, we go live on Tuesday the 18th in the morning?"],
      [2, 84, "Works for me. I'll prepare the social media post so it goes out the same day."],
      [1, 91, "And I'll keep the old version saved, in case we need to roll back."],
    ],
    notes: {
      h: "Launch · Tuesday 18th",
      p: "Home page done. Pricing and English copy left.",
      items: ["Final prices before Wednesday", "Review the English copy"],
      indent: "Marta reviews it before Friday",
      tasks: [["Change the form's address", true], ["Social media post", false]],
    },
    cover: {
      excerpt: "The team settles the date: the new website goes live on Tuesday the 18th in the morning, with pricing and the English copy finished before then.",
      tone: { label: "constructive", reason: "Everyone suggests solutions and the work is shared out without arguments." },
      summary: [
        "The home page is done; the pricing page and the English copy are still to do.",
        "Final prices will be agreed with management on Monday.",
        "The contact form still sends emails to the old address.",
        "The old version is kept so they can roll back.",
      ],
      decisions: [
        { text: "Launch the new website on Tuesday the 18th in the morning.", t: 78 },
        { text: "Marta reviews the English copy before Friday.", t: 41 },
      ],
      tasks: [
        { text: "Build the pricing page", owner: "Jordi", when: "Wednesday", t: 47 },
        { text: "Send the final prices", owner: "Marta", when: "Monday", t: 55 },
        { text: "Change the contact form's address", owner: "Jordi", when: "today", t: 70, done: true },
        { text: "Prepare the social media post", owner: "Laia", when: "Tuesday 18th", t: 84 },
      ],
      parts: [
        { t: 4, title: "Website status", points: ["Home page done", "Pricing and English copy left"] },
        { t: 55, title: "Pricing and the form", points: ["Prices agreed on Monday", "Form uses the old address"] },
        { t: 78, title: "Launch date", points: ["Tuesday 18th, morning", "Post goes out the same day"] },
      ],
    },
    others: [
      ["Weekly check-in", 0.2, ["North Studio"]],
      ["Interview with Núria", 1, []],
      ["2027 budget", 1.3, ["Management"]],
      ["Meeting with the bank", 3, []],
      ["CRM training", 6, ["North Studio"]],
    ],
    slides: [
      ["New website", "Launch plan", ["Home page ✓", "Pricing", "English copy", "Go live: Tuesday 18th"]],
      ["Pricing page", "Three plans", ["Basic", "Team", "Business"]],
    ],
    search: "prices",
  },
};

export const slideHtml = (lang, i) => {
  const [title, sub, items] = T[lang].slides[i];
  return `<!doctype html><meta charset=utf-8><body style="margin:0;width:1280px;height:720px;font-family:-apple-system,Helvetica,sans-serif;background:#f4f1ea;color:#1d1d1f;display:flex">
<div style="padding:90px 100px;flex:1"><div style="font-size:22px;letter-spacing:.08em;text-transform:uppercase;color:#8a7f6a">${sub}</div>
<div style="font-size:84px;font-weight:700;margin:16px 0 48px">${title}</div>
${items.map((x) => `<div style="font-size:34px;padding:14px 0;border-top:2px solid #e2dccf">${x}</div>`).join("")}</div>
<div style="width:360px;background:#2f5d50"></div></body>`;
};

export function seed(lang, screens) {
  const c = T[lang];
  const at = today10;
  const scale = 20; // spread the sample lines over a 34-minute meeting
  const utterances = c.lines.map(([speaker, s, text], i) => ({ id: `u${i}`, start: s * scale, end: (c.lines[i + 1]?.[1] ?? 102) * scale - 2, speaker, text }));
  const n = c.notes;
  const stamp = (s) => ({ t: s * scale });
  const notesDoc = { type: "doc", content: [
    { type: "heading", attrs: { level: 2, ...stamp(5) }, content: [{ type: "text", text: n.h }] },
    { type: "paragraph", attrs: stamp(22), content: [{ type: "text", text: n.p }] },
    { type: "bulletList", content: n.items.map((x, i) => ({ type: "listItem", attrs: stamp(48 + i * 8), content: [{ type: "paragraph", content: [{ type: "text", text: x }] }] })) },
    { type: "paragraph", attrs: { ...stamp(57), indent: 1 }, content: [{ type: "text", text: n.indent }] },
    { type: "taskList", content: n.tasks.map(([x, done], i) => ({ type: "taskItem", attrs: { checked: done, ...stamp(70 + i * 14) }, content: [{ type: "paragraph", content: [{ type: "text", text: x }] }] })) },
  ] };
  const cover = { generatedAt: at + 35 * 60e3, lang, ...c.cover,
    decisions: c.cover.decisions.map((d) => ({ ...d, t: d.t * scale })),
    tasks: c.cover.tasks.map((d) => ({ ...d, t: d.t * scale })),
    parts: c.cover.parts.map((d) => ({ ...d, t: d.t * scale })) };
  const main = {
    id: "main", title: c.title, createdAt: at, duration: 34 * 60, status: "done", utterances,
    speakerNames: Object.fromEntries(c.names.map((x, i) => [i, x])), notes: [], notesDoc, cover,
    screens: screens.map((path, i) => ({ t: (i ? 47 : 12) * scale + 5, path })), tags: c.tags, language: lang === "en" ? "en" : "ca-es",
    sources: { mic: true, system: true },
  };
  const others = c.others.map(([title, days, tags], i) => ({
    id: `o${i}`, title, createdAt: at - days * DAY - i * 3600e3, duration: [1500, 2700, 3300, 1900, 4200][i], status: "done",
    utterances: [{ id: "x", start: 1, end: 3, speaker: 0, text: "…" }], speakerNames: {}, notes: [], tags,
  }));
  return { meetings: [main, ...others], search: c.search, title: c.title };
}
