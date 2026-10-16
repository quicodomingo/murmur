"""Local web server for the live MVP.

    uv run python -m mvp.server        →  http://localhost:8765   (PORT=… to change it)

The browser captures the microphone at 16 kHz and streams Float32 PCM over a WebSocket; inference
runs in a worker thread so the event loop stays responsive.
"""

import asyncio
import json
import os
import queue
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from mvp.live import LiveSession, Models

STATIC = Path(__file__).parent / "static"

PORT = int(os.environ.get("PORT", "8765"))
models: Models | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global models
    models = Models()
    print(f"Models carregats — obre http://localhost:{PORT}", flush=True)
    yield


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


def worker(session: LiveSession, inbox: queue.Queue, send) -> None:
    while True:
        item = inbox.get()
        if item is None:
            for event in session.finish():
                send(event)
            send({"type": "done"})
            return
        chunks = [item]
        while not inbox.empty():  # catch up if inference fell behind
            nxt = inbox.get()
            if nxt is None:
                inbox.put(None)
                break
            chunks.append(nxt)
        for event in session.accept(np.concatenate(chunks)):
            send(event)


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    loop = asyncio.get_running_loop()
    config = json.loads(await ws.receive_text())
    session = LiveSession(
        models,
        max_speakers=int(config.get("maxSpeakers", 5)),
        threshold=float(config.get("threshold", 0.65)),
    )
    inbox: queue.Queue = queue.Queue()

    def send(event: dict) -> None:
        asyncio.run_coroutine_threadsafe(ws.send_json(event), loop)

    thread = threading.Thread(target=worker, args=(session, inbox, send), daemon=True)
    thread.start()
    await ws.send_json({"type": "ready"})
    try:
        while True:
            msg = await ws.receive()
            if msg.get("bytes"):
                inbox.put(np.frombuffer(msg["bytes"], dtype=np.float32).copy())
            elif msg.get("text") and json.loads(msg["text"]).get("type") == "stop":
                inbox.put(None)
                await asyncio.to_thread(thread.join)
                break
            elif msg["type"] == "websocket.disconnect":
                inbox.put(None)
                break
    except WebSocketDisconnect:
        inbox.put(None)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
