import assert from "node:assert/strict";
import test from "node:test";

import { mime, validate } from "./src/message.js";

const ok = { kind: "bug", message: "La gravació es para quan tanco la tapa.", app: "desktop 0.19.0", system: { os: "macOS", osVersion: "26.1", language: "ca" } };

test("a good message is kept as it came", () => {
  const fb = validate({ ...ok, email: " nom@exemple.cat " });
  assert.equal(fb.error, undefined);
  assert.equal(fb.email, "nom@exemple.cat");
  assert.deepEqual(fb.system, { os: "macOS", osVersion: "26.1", language: "ca" });
  assert.equal(fb.log, null);
});

test("bad messages are turned away", () => {
  assert.equal(validate({ ...ok, kind: "spam" }).error, "kind");
  assert.equal(validate({ ...ok, message: "hola" }).error, "message too short");
  assert.equal(validate({ ...ok, message: "x".repeat(5001) }).error, "message too long");
  assert.equal(validate({ ...ok, email: "no és un correu" }).error, "email");
  assert.equal(validate({ ...ok, app: "<script>" }).error, "app");
  assert.equal(validate({ ...ok, log: "x".repeat(400 * 1024) }).error, "log too long");
  assert.equal(validate(null).error, "bad request");
});

test("the email carries the text, who to answer and the log", () => {
  const fb = validate({ ...ok, email: "nom@exemple.cat", log: "2026-11-25 10:00:00 INFO Murmur 0.19.0" });
  const raw = mime(fb, { id: "abc", from: "murmur@exemple.cat", to: "jo@exemple.cat", date: new Date(0) });
  assert.match(raw, /^From: Murmur <murmur@exemple\.cat>\r\n/);
  assert.match(raw, /\r\nReply-To: nom@exemple\.cat\r\n/);
  assert.match(raw, /\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(raw, /filename="murmur\.log"/);
  const text = Buffer.from(raw.split("\r\n\r\n")[2].split("\r\n--")[0].replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.match(text, /^La gravació es para quan tanco la tapa\./);
  assert.match(text, /Respon a: nom@exemple\.cat/);
  // Without an email: no Reply-To.
  assert.doesNotMatch(mime(validate(ok), { id: "x", from: "a@b.c", to: "d@e.f" }), /Reply-To/);
});
