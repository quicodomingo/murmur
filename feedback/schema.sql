-- Murmur's feedback (docs/COMENTARIS.md): one row per message.
CREATE TABLE IF NOT EXISTS feedback (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,          -- milliseconds since the epoch
  kind       TEXT NOT NULL,             -- bug, idea, other
  message    TEXT NOT NULL,
  email      TEXT,                      -- only if the person left it, to answer
  context    TEXT,                      -- the error it came from, if any
  app        TEXT NOT NULL,             -- "desktop 0.19.0", "iphone 1.1"
  system     TEXT NOT NULL,             -- JSON: os, version, machine, memory, language
  log        TEXT,                      -- Murmur's log, only if the person ticked it
  sender     TEXT NOT NULL              -- a salted hash of the IP, for the rate limit; never the IP
);
CREATE INDEX IF NOT EXISTS feedback_sender ON feedback (sender, created_at);
