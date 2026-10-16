//! The after-recording steps without the UI, driven by JSON on stdin (for scripts that reuse the
//! app's prompts from src/lib/cover.ts):
//!     post_probe punctuate < {"texts": [...], "speakers": [...]}        → ["…", …]
//!     post_probe llm < {"system": "…", "document": "…", "tasks": [...]}  → [{"id", "text", …}]
use std::io::Read;
use std::time::Instant;

use serde::Deserialize;
use serde_json::{Value, json};
use transcriptor_lib::{engine::models_dir, llm::Llm, models, punctuate::Punctuator};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Task {
    id: String,
    prompt: String,
    max_tokens: usize,
    schema: Option<String>,
}

fn main() -> anyhow::Result<()> {
    let mode = std::env::args().nth(1).unwrap_or_default();
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let input: Value = serde_json::from_str(&input)?;
    let out = match mode.as_str() {
        "punctuate" => {
            let texts: Vec<String> = serde_json::from_value(input["texts"].clone())?;
            let speakers: Vec<i32> = serde_json::from_value(input["speakers"].clone())?;
            let mut p = Punctuator::load(&models::PUNCTUATION.path(&models_dir()))?;
            let t0 = Instant::now();
            let out = p.punctuate(&texts, &speakers)?;
            eprintln!("puntuació: {:.1}s", t0.elapsed().as_secs_f32());
            json!(out)
        }
        "llm" => {
            let tasks: Vec<Task> = serde_json::from_value(input["tasks"].clone())?;
            let t0 = Instant::now();
            let llm = Llm::load(&models::LLM.file(&models_dir(), 0))?;
            eprintln!("càrrega: {:.1}s", t0.elapsed().as_secs_f32());
            let mut s = llm.session(input["system"].as_str().unwrap_or(""), input["document"].as_str().unwrap_or(""))?;
            eprintln!("lectura: {} tokens en {:.1}s", s.prefix_tokens(), s.read_seconds);
            let mut results = vec![];
            for t in tasks {
                let a = s.ask(&t.prompt, t.max_tokens, t.schema.as_deref());
                match a {
                    Ok(a) => {
                        eprintln!("{}: {:.1}s, {} tokens", t.id, a.seconds, a.generated_tokens);
                        results.push(json!({"id": t.id, "text": a.text, "error": null, "seconds": a.seconds, "tokens": a.generated_tokens}));
                    }
                    Err(e) => results.push(json!({"id": t.id, "text": null, "error": format!("{e:#}"), "seconds": 0, "tokens": 0})),
                }
            }
            json!(results)
        }
        _ => anyhow::bail!("mode: punctuate | llm"),
    };
    println!("{out}");
    Ok(())
}
