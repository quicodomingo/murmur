const $ = (id) => document.getElementById(id);
const els = {
  record: $("record"), recordLabel: $("record-label"), exportBtn: $("export"), jump: $("jump"),
  state: $("state"), timer: $("timer"), meter: $("meter-fill"),
  empty: $("empty"), utterances: $("utterances"), partial: $("partial"),
  speakers: $("speakers"), speakersEmpty: $("speakers-empty"),
  device: $("device"), maxSpeakers: $("max-speakers"), threshold: $("threshold"),
  thresholdValue: $("threshold-value"), toast: $("toast"),
};

const SPEAKER_HUES = 6;
const state = {
  recording: false, busy: false,
  ws: null, ctx: null, stream: null, node: null,
  startedAt: 0, timerId: 0,
  utterances: [], // {id, start, speaker, text}
  names: new Map(), // speaker index -> name
  followTail: true,
};

/* ---------- helpers ---------- */

const fmt = (s) => {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};
const speakerName = (i) => state.names.get(i) || `Parlant ${i + 1}`;
const speakerStyle = (el, i) => {
  const hue = (i % SPEAKER_HUES) + 1;
  el.style.setProperty("--chip-bg", `var(--spk-${hue}-bg)`);
  el.style.setProperty("--chip-fg", `var(--spk-${hue}-fg)`);
};

function setStatus(text, kind = "") {
  els.state.textContent = text;
  els.state.dataset.state = kind;
}

let toastTimer = 0;
function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 5000);
}

/* ---------- rendering ---------- */

function makeChip(speaker) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  chip.dataset.speaker = speaker;
  speakerStyle(chip, speaker);
  chip.innerHTML = `<span class="chip-badge" aria-hidden="true">${speaker + 1}</span><span class="chip-name"></span>`;
  chip.querySelector(".chip-name").textContent = speakerName(speaker);
  chip.setAttribute("aria-label", `${speakerName(speaker)} — reanomenar`);
  chip.addEventListener("click", () => {
    const input = els.speakers.querySelector(`input[data-speaker="${speaker}"]`);
    input?.focus();
    input?.select();
  });
  return chip;
}

function addUtterance(u) {
  els.empty.hidden = true;
  const last = state.utterances.at(-1);
  // Consecutive lines from the same speaker read as one paragraph.
  if (last && last.speaker === u.speaker) {
    last.text += " " + u.text;
    last.el.querySelector(".utterance-text").textContent = last.text;
  } else {
    const li = document.createElement("li");
    li.className = "utterance";
    const head = document.createElement("div");
    head.className = "utterance-head";
    head.append(makeChip(u.speaker));
    const time = document.createElement("time");
    time.className = "utterance-time";
    time.textContent = fmt(u.start);
    head.append(time);
    const p = document.createElement("p");
    p.className = "utterance-text";
    p.textContent = u.text;
    li.append(head, p);
    els.utterances.append(li);
    state.utterances.push({ ...u, el: li });
  }
  ensureSpeaker(u.speaker);
  els.exportBtn.disabled = false;
  scrollToTail();
}

function ensureSpeaker(i) {
  if (els.speakers.querySelector(`[data-speaker="${i}"]`)) return;
  els.speakersEmpty.hidden = true;
  const li = document.createElement("li");
  li.className = "speaker";
  li.dataset.speaker = i;
  speakerStyle(li, i);
  const id = `speaker-name-${i}`;
  li.innerHTML = `
    <span class="chip-badge" aria-hidden="true">${i + 1}</span>
    <label class="visually-hidden" for="${id}">Nom del parlant ${i + 1}</label>
    <input id="${id}" type="text" data-speaker="${i}" placeholder="Parlant ${i + 1}" autocomplete="off">`;
  const input = li.querySelector("input");
  input.value = state.names.get(i) || "";
  input.addEventListener("input", () => {
    const name = input.value.trim();
    name ? state.names.set(i, name) : state.names.delete(i);
    document.querySelectorAll(`.chip[data-speaker="${i}"]`).forEach((chip) => {
      chip.querySelector(".chip-name").textContent = speakerName(i);
      chip.setAttribute("aria-label", `${speakerName(i)} — reanomenar`);
    });
  });
  const items = [...els.speakers.children];
  const before = items.find((el) => Number(el.dataset.speaker) > i);
  els.speakers.insertBefore(li, before || null);
}

function setPartial(text) {
  els.partial.hidden = !text;
  els.partial.textContent = text;
  if (text) {
    els.empty.hidden = true;
    scrollToTail();
  }
}

/* ---------- scrolling: follow the tail unless the user scrolled up ---------- */

const atBottom = () =>
  window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120;

function scrollToTail() {
  if (state.followTail) window.scrollTo({ top: document.documentElement.scrollHeight });
}

window.addEventListener("scroll", () => {
  state.followTail = atBottom();
  els.jump.hidden = state.followTail || state.utterances.length === 0;
}, { passive: true });

els.jump.addEventListener("click", () => {
  state.followTail = true;
  els.jump.hidden = true;
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
});

/* ---------- devices ---------- */

async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const current = els.device.value;
  els.device.innerHTML = '<option value="">Per defecte del sistema</option>';
  devices.filter((d) => d.kind === "audioinput" && d.deviceId !== "default").forEach((d, n) => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Micròfon ${n + 1}`;
    els.device.append(opt);
  });
  els.device.value = current;
}

/* ---------- recording ---------- */

function setControlsLocked(locked) {
  for (const el of [els.device, els.maxSpeakers, els.threshold]) el.disabled = locked;
}

function openSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => ws.send(JSON.stringify({
      maxSpeakers: Number(els.maxSpeakers.value) || 5,
      threshold: Number(els.threshold.value),
    }));
    ws.onmessage = (msg) => {
      const event = JSON.parse(msg.data);
      if (event.type === "ready") resolve(ws);
      else if (event.type === "partial") setPartial(event.text);
      else if (event.type === "final") { setPartial(""); addUtterance(event); }
      else if (event.type === "done") ws.close();
    };
    ws.onerror = () => reject(new Error("No s'ha pogut connectar amb el servidor local."));
    ws.onclose = () => {
      if (state.recording) { stopAudio(); finishUi(); toast("S'ha perdut la connexió amb el servidor local."); }
    };
  });
}

async function start() {
  state.busy = true;
  els.record.disabled = true;
  setStatus("Connectant…");
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: els.device.value ? { exact: els.device.value } : undefined,
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      },
    });
    listDevices();
    state.ws = await openSocket();
    state.ctx = new AudioContext();
    await state.ctx.audioWorklet.addModule("/static/capture-worklet.js");
    const source = state.ctx.createMediaStreamSource(state.stream);
    state.node = new AudioWorkletNode(state.ctx, "capture-processor");
    state.node.port.onmessage = ({ data }) => {
      if (data.type === "audio" && state.ws?.readyState === WebSocket.OPEN) state.ws.send(data.samples.buffer);
      else if (data.type === "level") els.meter.style.transform = `scaleX(${Math.min(1, data.rms * 8)})`;
    };
    source.connect(state.node);

    state.recording = true;
    state.startedAt = performance.now();
    state.timerId = setInterval(() => (els.timer.textContent = fmt((performance.now() - state.startedAt) / 1000)), 500);
    els.record.setAttribute("aria-pressed", "true");
    els.recordLabel.textContent = "Aturar";
    setControlsLocked(true);
    setStatus("Escoltant", "recording");
  } catch (err) {
    stopAudio();
    state.ws?.close();
    setStatus("Error", "error");
    toast(err.name === "NotAllowedError"
      ? "Cal donar permís al micròfon per poder transcriure. Revisa la configuració del navegador."
      : err.message);
  } finally {
    state.busy = false;
    els.record.disabled = false;
  }
}

function stopAudio() {
  state.node?.disconnect();
  state.ctx?.close();
  state.stream?.getTracks().forEach((t) => t.stop());
  state.node = state.ctx = state.stream = null;
  els.meter.style.transform = "scaleX(0)";
}

function finishUi() {
  state.recording = false;
  clearInterval(state.timerId);
  els.record.setAttribute("aria-pressed", "false");
  els.recordLabel.textContent = "Gravar";
  setControlsLocked(false);
  setPartial("");
  setStatus("Aturat");
}

function stop() {
  stopAudio();
  // The server flushes the last utterance and then sends "done".
  state.ws?.send(JSON.stringify({ type: "stop" }));
  finishUi();
}

els.record.addEventListener("click", () => {
  if (state.busy) return;
  state.recording ? stop() : start();
});

document.addEventListener("keydown", (e) => {
  const typing = ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(document.activeElement?.tagName);
  if (e.code === "Space" && !typing) {
    e.preventDefault();
    els.record.click();
  }
});

els.threshold.addEventListener("input", () => {
  els.thresholdValue.textContent = Number(els.threshold.value).toFixed(2).replace(".", ",");
});

/* ---------- export ---------- */

els.exportBtn.addEventListener("click", () => {
  const date = new Date().toLocaleString("ca-ES");
  const lines = [`# Transcripció — ${date}`, ""];
  for (const u of state.utterances) lines.push(`**[${fmt(u.start)}] ${speakerName(u.speaker)}:** ${u.text}`, "");
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `transcripcio-${new Date().toISOString().slice(0, 16).replace(":", "")}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
});

listDevices().catch(() => {});
