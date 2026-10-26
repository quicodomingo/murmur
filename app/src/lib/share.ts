import { useSyncExternalStore } from "react";
import type { JSONContent } from "@tiptap/core";

import { isYou, speakerHue, toneOrder } from "@/components/SpeakerFlag";
import * as backend from "./backend";
import { namedSpeakers, renameInCover, talkTime, toneLabel } from "./cover";
import { clock, duration, longDate, speakerIds, speakerName } from "./format";
import { locale, t, uiLanguage } from "./i18n";
import { notesDoc } from "./notes";
import type { Meeting, ShareLink, SharePart } from "./types";

// Shared links (docs/COMPARTIR.md). The meeting is put together here as the page will show it,
// already translated, then compressed and encrypted with AES-GCM; only that goes to the user's
// Cloudflare Worker (share/, through share.rs). The key goes in the link after the #, which
// browsers never send to the server, or comes from a password: neither Cloudflare nor the
// Worker can read what they keep.

export type ShareExpiry = "1d" | "7d" | "30d" | "never";
export const SHARE_EXPIRIES: ShareExpiry[] = ["1d", "7d", "30d", "never"];
const TTL: Record<ShareExpiry, number | null> = { "1d": 86400, "7d": 7 * 86400, "30d": 30 * 86400, never: null };

/** PBKDF2 rounds for a password (OWASP's figure for SHA-256). */
const ITERATIONS = 600_000;

// --- Connection to the Worker --------------------------------------------------------------

let status: backend.ShareStatus | null | undefined;
const listeners = new Set<() => void>();
const set = (next: backend.ShareStatus | null) => {
  status = next;
  listeners.forEach((l) => l());
};

export async function refreshShare() {
  if (!backend.isTauri()) return set(null);
  set(await backend.shareStatus());
}

/** The connected Worker; undefined while asking, null when there's none. */
export function useShareStatus(): backend.ShareStatus | null | undefined {
  if (status === undefined && !listeners.size) refreshShare().catch((e) => console.error(e));
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

export async function connectShare(url: string, key: string) {
  set(await backend.shareConnect(url, key));
}

export async function disconnectShare() {
  await backend.shareDisconnect();
  set(null);
}

// --- What the page shows -------------------------------------------------------------------

type Run = { t?: string; b?: true; i?: true; u?: true; s?: true; code?: true; href?: string; br?: true };
type Block =
  | { type: "h"; level: number; runs: Run[] }
  | { type: "p"; at?: string; runs: Run[] }
  | { type: "quote"; blocks: Block[] }
  | { type: "ul" | "ol" | "todo"; items: { at?: string; checked?: boolean; runs: Run[]; children: Block[] }[] };

function runs(nodes: JSONContent[] = []): Run[] {
  return nodes.map((n) => {
    if (n.type === "hardBreak") return { br: true };
    const run: Run = { t: n.text ?? "" };
    for (const mark of n.marks ?? []) {
      if (mark.type === "bold") run.b = true;
      else if (mark.type === "italic") run.i = true;
      else if (mark.type === "underline") run.u = true;
      else if (mark.type === "strike") run.s = true;
      else if (mark.type === "code") run.code = true;
      else if (mark.type === "link" && typeof mark.attrs?.href === "string") run.href = mark.attrs.href;
    }
    return run;
  });
}

const stamp = (node: JSONContent) => (node.attrs?.t != null ? clock(node.attrs.t) : undefined);

function blocks(nodes: JSONContent[] = []): Block[] {
  return nodes.flatMap((n): Block[] => {
    switch (n.type) {
      case "heading":
        return [{ type: "h", level: n.attrs?.level ?? 1, runs: runs(n.content) }];
      case "paragraph":
        return n.content?.length ? [{ type: "p", at: stamp(n), runs: runs(n.content) }] : [];
      case "blockquote":
        return [{ type: "quote", blocks: blocks(n.content) }];
      case "bulletList":
      case "orderedList":
      case "taskList":
        return [
          {
            type: n.type === "orderedList" ? "ol" : n.type === "taskList" ? "todo" : "ul",
            items: (n.content ?? []).map((item) => {
              const [first, ...rest] = item.content ?? [];
              return { at: stamp(item), checked: item.attrs?.checked || undefined, runs: runs(first?.content), children: blocks(rest) };
            }),
          },
        ];
      default:
        return blocks(n.content);
    }
  });
}

/** What can be shared of a meeting: the cover once there is one, notes once written. */
export function shareableParts(m: Meeting): SharePart[] {
  const notes = blocks(notesDoc(m).content);
  return [m.cover && "cover", notes.length > 0 && "notes", m.utterances.length > 0 && "transcript"].filter(Boolean) as SharePart[];
}

/** The meeting as the shared page draws it (share/public/viewer.js), in the interface's language. */
function page(m: Meeting, parts: SharePart[], expiresAt: number | null) {
  const order = toneOrder(m, speakerIds(m));
  const speakers = Object.fromEntries(
    speakerIds(m).map((id) => [id, { name: speakerName(m, id), tone: isYou(m, id) ? "you" : speakerHue(id, order) }]),
  );
  const talk = talkTime(m);
  const cover = parts.includes("cover") && m.cover ? renameInCover(m.cover, namedSpeakers(m)) : null;
  const ownerOf = (owner: string) => {
    const lower = (s: string) => s.toLocaleLowerCase(locale());
    return talk.find((s) => lower(s.name) === lower(owner) || lower(s.name).split(" ")[0] === lower(owner).split(" ")[0])?.speaker;
  };
  const sharedOn = longDate(Date.now());

  return {
    v: 1,
    lang: uiLanguage(),
    title: m.title,
    meta: [longDate(m.createdAt), duration(m.duration)],
    tags: m.tags ?? [],
    labels: {
      cover: t("share:page.cover"),
      notes: t("export:notes"),
      transcript: t("export:transcript"),
      tone: t("cover:tone"),
      talk: t("cover:talk"),
      summary: t("cover:summary"),
      decisions: t("cover:decisions"),
      tasks: t("cover:tasks"),
      parts: t("cover:parts"),
      taskDone: t("share:page.taskDone"),
      taskOpen: t("share:page.taskOpen"),
    },
    speakers,
    cover: cover && {
      excerpt: cover.excerpt,
      tone: cover.tone && { label: toneLabel(cover.tone.label), reason: cover.tone.reason },
      talk: talk.map((s) => ({
        speaker: s.speaker,
        name: s.name,
        fraction: s.share,
        share: s.share < 0.01 ? "<1%" : `${Math.round(s.share * 100)}%`,
        time: s.seconds < 60 ? t("cover:talkUnderMinute") : t("cover:talkMinutes", { minutes: Math.round(s.seconds / 60) }),
      })),
      summary: cover.summary,
      decisions: cover.decisions?.map((d) => ({ text: d.text, at: d.t != null ? clock(d.t) : undefined })),
      tasks: cover.tasks?.map((task) => ({
        text: task.text,
        owner: task.owner ?? undefined,
        speaker: task.owner ? ownerOf(task.owner) : undefined,
        when: task.when ?? undefined,
        at: task.t != null ? clock(task.t) : undefined,
        done: !!task.done,
      })),
      parts: cover.parts?.map((p) => ({ at: clock(p.t), title: p.title, points: p.points })),
    },
    notes: parts.includes("notes") ? blocks(notesDoc(m).content) : undefined,
    transcript: parts.includes("transcript") ? m.utterances.map((u) => ({ s: u.speaker, at: clock(u.start), text: u.text })) : undefined,
    footer: expiresAt ? t("share:page.footerExpires", { date: sharedOn, expires: longDate(expiresAt) }) : t("share:page.footer", { date: sharedOn }),
  };
}

// --- Encryption ----------------------------------------------------------------------------

function base64(bytes: Uint8Array, url = false): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const s = btoa(binary);
  return url ? s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : s;
}

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

/** The envelope the Worker keeps, and the key for the link (none with a password). */
async function encrypt(content: object, password: string | null): Promise<{ envelope: string; secret: string | null }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let key: CryptoKey;
  let secret: string | null = null;
  let kdf: object | undefined;
  if (password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    kdf = { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: base64(salt) };
  } else {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
    secret = base64(raw, true);
  }
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await gzip(JSON.stringify(content))));
  return { envelope: JSON.stringify({ v: 1, iv: base64(iv), data: base64(data), kdf }), secret };
}

// --- Sharing -------------------------------------------------------------------------------

/** Encrypts the chosen parts and uploads them; the new link, ready to save with the meeting. */
export async function shareMeeting(m: Meeting, parts: SharePart[], expiry: ShareExpiry, password: string | null): Promise<ShareLink> {
  const ttl = TTL[expiry];
  const expiresAt = ttl ? Date.now() + ttl * 1000 : null;
  const { envelope, secret } = await encrypt(page(m, parts, expiresAt), password);
  const published = await backend.sharePublish(envelope, ttl);
  return {
    id: published.id,
    url: secret ? `${published.url}#${secret}` : published.url,
    createdAt: Date.now(),
    expiresAt: published.expiresAt ?? expiresAt,
    password: !!password,
    parts,
  };
}

export const revokeShare = (id: string) => backend.shareRevoke(id);

export const expired = (link: ShareLink, now = Date.now()) => link.expiresAt !== null && link.expiresAt <= now;
