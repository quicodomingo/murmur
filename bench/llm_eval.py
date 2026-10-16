"""Run meeting tasks against an OpenAI-compatible local server (llama.cpp's llama-server).

    llama-server -m models/llm/<model>.gguf -c 32768 -ngl 99 --port 8091 --jinja
    uv run python -m bench.llm_eval results/reunio/transcript.conformer-ca-es-rnnt.md gemma4-e2b

Writes one Markdown file per task plus timings to results/llm/<name>/.
"""

import json
import sys
import time
import urllib.request
from pathlib import Path

SERVER = "http://127.0.0.1:8091"
THINKING = False

SYSTEM = (
    "Ets un assistent que treballa amb transcripcions de reunions en català. La transcripció "
    "s'ha fet automàticament: no té puntuació, pot tenir paraules mal reconegudes (sobretot "
    "noms i marques) i hi ha fragments en castellà. Respon sempre en català correcte i natural. "
    "No t'inventis res que no surti a la transcripció."
)

# (name, instruction, input: "full" transcript or "excerpt", max tokens)
TASKS = [
    (
        "1-puntuacio",
        "Posa puntuació, majúscules i paràgrafs a aquest fragment. Conserva les paraules tal com "
        "són (no resumeixis ni canviïs l'ordre), però corregeix els noms i marques evidents "
        "(per exemple «worpress» → WordPress). Mantén les etiquetes de parlant i el minut.",
        "excerpt",
        1200,
    ),
    ("2-titol", "Proposa un títol breu (màxim 8 paraules) per a aquesta reunió. Respon només amb el títol.", "full", 40),
    (
        "3-resum-acords-tasques",
        "Fes l'acta d'aquesta reunió amb tres seccions en Markdown:\n"
        "## Resum (5–8 frases)\n## Acords (llista)\n## Tasques (llista: tasca, responsable si es diu, data si es diu)\n"
        "Per a cada acord i tasca, indica entre claudàtors el minut de la transcripció d'on surt, p. ex. [04:21].",
        "full",
        900,
    ),
    (
        "4-capitols",
        "Divideix la reunió en 4–8 temes. Per a cada tema dona el minut on comença (format [mm:ss], "
        "tal com surt a la transcripció) i un títol curt. Respon només amb la llista.",
        "full",
        300,
    ),
    (
        "5-preguntes",
        "Respon breument aquestes preguntes a partir de la transcripció, citant el minut entre claudàtors:\n"
        "1. Quins models de traducció hi ha i quins són gratuïts o de pagament?\n"
        "2. Què s'ha de fer amb el TPV del banc i per què?\n"
        "3. Qui és el client final del producte?",
        "full",
        500,
    ),
]


def post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        SERVER + path, json.dumps(payload).encode(), {"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=1800) as r:
        return json.loads(r.read())


def main() -> None:
    transcript = Path(sys.argv[1]).read_text()
    name = sys.argv[2]
    out = Path("results/llm") / name
    out.mkdir(parents=True, exist_ok=True)
    # The excerpt: the first ~2.5 minutes.
    lines = transcript.splitlines()
    excerpt = "\n".join(l for l in lines if l.startswith("**[00:") or l.startswith("**[01:") or l.startswith("**[02:0"))
    report = {}
    for task, instruction, source, max_tokens in TASKS:
        text = excerpt if source == "excerpt" else transcript
        t0 = time.perf_counter()
        r = post(
            "/v1/chat/completions",
            {
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": f"{instruction}\n\n---\n{text}"},
                ],
                "temperature": 0.3,
                "max_tokens": max_tokens,
                # Gemma 4 thinks by default and can spend the whole budget before answering.
                "chat_template_kwargs": {"enable_thinking": THINKING},
            },
        )
        wall = time.perf_counter() - t0
        answer = r["choices"][0]["message"]["content"]
        t = r.get("timings", {})
        report[task] = {
            "wall_s": round(wall, 1),
            "prompt_tokens": t.get("prompt_n"),
            "prompt_tok_s": round(t.get("prompt_per_second", 0), 1),
            "generated_tokens": t.get("predicted_n"),
            "gen_tok_s": round(t.get("predicted_per_second", 0), 1),
        }
        (out / f"{task}.md").write_text(answer.strip() + "\n")
        print(f"{task}: {report[task]}")
    (out / "timings.json").write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
