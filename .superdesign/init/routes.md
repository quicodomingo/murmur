# Routes

| Path | File | Description |
|---|---|---|
| `/` | `mvp/static/index.html` | Live transcription: record, live partial + final utterances grouped by speaker, rename speakers, settings, export Markdown |
| `/ws` | `mvp/server.py` | WebSocket: audio in, `partial`/`final`/`done` events out |
