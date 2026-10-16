//! Load Gemma in-process, read a transcript once, ask a few questions (checks speed and Metal).
//!     cargo run --release --example llm_probe -- ../../models/llm/gemma-4-E4B_q4_0-it.gguf ../../results/reunio/transcript.conformer-ca-es-rnnt.md
use std::path::Path;
use std::time::Instant;
use transcriptor_lib::llm::Llm;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let t0 = Instant::now();
    let llm = Llm::load(Path::new(&args[1]))?;
    println!("model carregat en {:.1}s", t0.elapsed().as_secs_f32());
    let doc = std::fs::read_to_string(&args[2])?;
    let mut s = llm.session("Ets un assistent que resumeix reunions en català. Respon sempre en català correcte.", &doc)?;
    println!("lectura: {} tokens en {:.1}s ({:.0} tok/s)", s.prefix_tokens(), s.read_seconds, s.prefix_tokens() as f32 / s.read_seconds);
    let a = s.ask("Proposa un títol breu (màxim 8 paraules) per a aquesta reunió. Respon només amb el títol.", 40, None)?;
    println!("títol ({:.1}s, {} tokens): {}", a.seconds, a.generated_tokens, a.text);
    let schema = r#"{"type":"object","properties":{"excerpt":{"type":"string"},"tone":{"type":"string","enum":["constructiu","neutre","tens","conflictiu","distès","de rendició de comptes"]},"toneReason":{"type":"string"}},"required":["excerpt","tone","toneReason"]}"#;
    let a = s.ask("Escriu en JSON: un excerpt de 2 frases sobre de què va la reunió i què s'hi decideix, el to general i una frase que el justifiqui.", 400, Some(schema))?;
    println!("json ({:.1}s, {} tokens, {:.0} tok/s): {}", a.seconds, a.generated_tokens, a.generated_tokens as f32 / a.seconds, a.text);
    Ok(())
}
