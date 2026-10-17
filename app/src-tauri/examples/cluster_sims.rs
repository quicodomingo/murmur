//! Final-pass clusters of labelled spans and how alike their average voices are (3D-Speaker).
//!     cargo run --release --example cluster_sims -- reunio.wav qui-parla.json [threshold]
use sherpa_onnx::{SpeakerEmbeddingExtractor, SpeakerEmbeddingExtractorConfig};
use transcriptor_lib::diarize::{Options, Span, assign, diarize, embedding_model};
use transcriptor_lib::engine::models_dir;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let wave = sherpa_onnx::Wave::read(&args[1]).expect("read");
    let samples = wave.samples();
    let labelled: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(&args[2])?)?;
    let spans: Vec<Span> = labelled
        .iter()
        .map(|l| Span { start: l["start"].as_f64().unwrap() as f32, end: l["end"].as_f64().unwrap() as f32 })
        .collect();
    let threshold = args.get(3).map_or(Ok(0.9), |t| t.parse())?;
    let turns = diarize(&models_dir(), samples, Options { threshold, ..Default::default() })?;
    let speakers: Vec<usize> = assign(&spans, &turns, 0).iter().map(|a| a.speaker).collect();
    let extractor = SpeakerEmbeddingExtractor::create(&SpeakerEmbeddingExtractorConfig {
        model: Some(models_dir().join(embedding_model()).to_string_lossy().into_owned()),
        num_threads: 4,
        ..Default::default()
    })
    .expect("extractor");
    let n = speakers.iter().max().map_or(0, |m| m + 1);
    let mut sums = vec![vec![]; n];
    let mut secs = vec![0.0f32; n];
    // Centroids from the diarization turns, mapped to the assignment numbering by overlap.
    for (span, &spk) in spans.iter().zip(&speakers) {
        let (a, b) = ((span.start * 16000.0) as usize, ((span.end * 16000.0) as usize).min(samples.len()));
        if b <= a || span.end - span.start < 1.0 {
            continue;
        }
        let stream = extractor.create_stream().unwrap();
        stream.accept_waveform(16000, &samples[a..b]);
        stream.input_finished();
        if !extractor.is_ready(&stream) {
            continue;
        }
        let mut e = extractor.compute(&stream).unwrap();
        let norm = e.iter().map(|x| x * x).sum::<f32>().sqrt() + 1e-9;
        e.iter_mut().for_each(|x| *x /= norm);
        if sums[spk].is_empty() {
            sums[spk] = vec![0.0; e.len()];
        }
        sums[spk].iter_mut().zip(&e).for_each(|(s, x)| *s += x);
        secs[spk] += span.end - span.start;
    }
    let cos = |a: &[f32], b: &[f32]| {
        let n = |v: &[f32]| v.iter().map(|x| x * x).sum::<f32>().sqrt() + 1e-9;
        a.iter().zip(b).map(|(x, y)| x * y).sum::<f32>() / (n(a) * n(b))
    };
    let labels: Vec<String> = labelled.iter().map(|l| l["speaker"].as_str().unwrap_or("?").to_string()).collect();
    for i in 0..n {
        let who: Vec<&str> = speakers.iter().zip(&labels).filter(|(s, _)| **s == i).map(|(_, l)| l.as_str()).collect();
        let sims: Vec<String> = (0..n)
            .filter(|&j| j != i && !sums[i].is_empty() && !sums[j].is_empty())
            .map(|j| format!("{j}:{:.2}", cos(&sums[i], &sums[j])))
            .collect();
        println!("cluster {i} ({:.0}s) sims [{}] people {:?}", secs[i], sims.join(" "), who);
    }
    Ok(())
}
