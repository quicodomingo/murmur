//! The cover written by Claude or OpenAI instead of the local model, with the user's own API key
//! (Settings › Intel·ligència). Only the transcript's text is sent, never audio. The key lives in
//! the macOS keychain and never reaches the interface: it's set once and read here for each call.

use std::time::{Duration, Instant};

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::i18n::tr;

const SERVICE: &str = "com.quicodomingo.murmur.cloud";
/// Room for the model's thinking on top of the answer itself.
const MAX_TOKENS: usize = 16000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    OpenAI,
}

impl Provider {
    fn account(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::OpenAI => "openai",
        }
    }
}

/// Which provider and model write the cover.
#[derive(Debug, Clone, Deserialize)]
pub struct Engine {
    pub provider: Provider,
    pub model: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CloudModel {
    pub id: String,
    pub name: String,
}

pub struct Answer {
    pub text: String,
    pub generated_tokens: usize,
    pub seconds: f32,
}

// --- Keychain --------------------------------------------------------------------------------

pub fn key(provider: Provider) -> Result<String> {
    let bytes = security_framework::passwords::get_generic_password(SERVICE, provider.account())
        .map_err(|_| anyhow!(tr!("cloud_no_key")))?;
    String::from_utf8(bytes).map_err(|_| anyhow!(tr!("cloud_no_key")))
}

/// Checks the key against the provider (listing its models) and only then saves it.
pub fn connect(provider: Provider, key: &str) -> Result<Vec<CloudModel>> {
    let key = key.trim();
    let models = list_models(provider, key)?;
    security_framework::passwords::set_generic_password(SERVICE, provider.account(), key.as_bytes())
        .map_err(|e| anyhow!(tr!("cloud_keychain_failed", error = e)))?;
    Ok(models)
}

pub fn disconnect(provider: Provider) -> Result<()> {
    match security_framework::passwords::delete_generic_password(SERVICE, provider.account()) {
        Ok(()) => Ok(()),
        // Nothing saved: already disconnected.
        Err(e) if e.code() == -25300 => Ok(()),
        Err(e) => Err(anyhow!(tr!("cloud_keychain_failed", error = e))),
    }
}

/// The key's last four characters, to recognise it; None if there's no key.
pub fn key_hint(provider: Provider) -> Option<String> {
    let key = key(provider).ok()?;
    let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    Some(tail)
}

// --- Requests --------------------------------------------------------------------------------

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .build()
}

fn request(provider: Provider, method: &str, url: &str, key: &str) -> ureq::Request {
    let req = agent().request(method, url);
    match provider {
        Provider::Anthropic => req.set("x-api-key", key).set("anthropic-version", "2023-06-01"),
        Provider::OpenAI => req.set("Authorization", &format!("Bearer {key}")),
    }
}

/// A failed call as something the user can act on.
fn failure(e: ureq::Error) -> anyhow::Error {
    match e {
        ureq::Error::Status(code, response) => {
            let body: Value = response.into_json().unwrap_or(Value::Null);
            let detail = body["error"]["message"].as_str().unwrap_or("").to_string();
            match code {
                401 | 403 => anyhow!(tr!("cloud_bad_key")),
                429 => anyhow!(tr!("cloud_rate_limited")),
                500.. => anyhow!(tr!("cloud_unavailable", code = code)),
                _ if detail.is_empty() => anyhow!(tr!("server_status", code = code)),
                _ => anyhow!(detail),
            }
        }
        ureq::Error::Transport(_) => anyhow!(tr!("cloud_offline")),
    }
}

fn get(provider: Provider, url: &str, key: &str) -> Result<Value> {
    request(provider, "GET", url, key).call().map_err(failure)?.into_json().map_err(Into::into)
}

fn post(provider: Provider, url: &str, key: &str, body: &Value, extra: &[(&str, &str)]) -> Result<Value> {
    let mut req = request(provider, "POST", url, key);
    for (name, value) in extra {
        req = req.set(name, value);
    }
    req.send_json(body).map_err(failure)?.into_json().map_err(Into::into)
}

/// The models that can write a cover (text in, JSON out), newest first.
pub fn list_models(provider: Provider, key: &str) -> Result<Vec<CloudModel>> {
    match provider {
        Provider::Anthropic => {
            let body = get(provider, "https://api.anthropic.com/v1/models?limit=100", key)?;
            Ok(body["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| {
                    let id = m["id"].as_str()?;
                    // Claude 3 models don't follow a JSON schema.
                    (!id.starts_with("claude-3")).then(|| CloudModel {
                        id: id.into(),
                        name: m["display_name"].as_str().unwrap_or(id).into(),
                    })
                })
                .collect())
        }
        Provider::OpenAI => {
            let body = get(provider, "https://api.openai.com/v1/models", key)?;
            const NOT_TEXT: [&str; 8] = ["audio", "realtime", "transcribe", "tts", "image", "search", "instruct", "embedding"];
            let mut models: Vec<(i64, CloudModel)> = body["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| {
                    let id = m["id"].as_str()?;
                    (id.starts_with("gpt-") && !NOT_TEXT.iter().any(|w| id.contains(w)))
                        .then(|| (m["created"].as_i64().unwrap_or(0), CloudModel { id: id.into(), name: id.into() }))
                })
                .collect();
            models.sort_by(|a, b| b.0.cmp(&a.0));
            Ok(models.into_iter().map(|(_, m)| m).collect())
        }
    }
}

/// The local model's schemas, made strict for the APIs: every object closed, every property
/// required, and no array lengths (neither API takes them; the prompts already ask for them).
fn strict_schema(schema: &mut Value) {
    if let Some(obj) = schema.as_object_mut() {
        obj.remove("minItems");
        obj.remove("maxItems");
        if obj.get("type").and_then(Value::as_str) == Some("object") {
            obj.insert("additionalProperties".into(), Value::Bool(false));
            if let Some(props) = obj.get("properties").and_then(Value::as_object) {
                let names: Vec<Value> = props.keys().cloned().map(Value::String).collect();
                obj.insert("required".into(), Value::Array(names));
            }
        }
        for value in obj.values_mut() {
            strict_schema(value);
        }
    } else if let Some(items) = schema.as_array_mut() {
        items.iter_mut().for_each(strict_schema);
    }
}

/// Claude models that take the server-side fallback for declined requests.
fn takes_fallback(model: &str) -> bool {
    ["claude-fable-5", "claude-opus-5", "claude-sonnet-5-5"].iter().any(|p| model.starts_with(p))
}

/// One question about the document. The document goes first and the same each time, so the
/// providers' prompt cache reads it once for the whole cover.
pub fn ask(engine: &Engine, key: &str, system: &str, document: &str, question: &str, schema: Option<&str>) -> Result<Answer> {
    let t0 = Instant::now();
    let schema = schema
        .map(|s| -> Result<Value> {
            let mut v: Value = serde_json::from_str(s)?;
            strict_schema(&mut v);
            Ok(v)
        })
        .transpose()?;
    let document = format!("{document}\n\n---\n");
    let (text, tokens) = match engine.provider {
        Provider::Anthropic => {
            let mut body = json!({
                "model": engine.model,
                "max_tokens": MAX_TOKENS,
                "system": system,
                "messages": [{
                    "role": "user",
                    "content": [
                        { "type": "text", "text": document, "cache_control": { "type": "ephemeral" } },
                        { "type": "text", "text": question },
                    ],
                }],
                "output_config": { "effort": "low" },
            });
            if let Some(schema) = schema {
                body["output_config"]["format"] = json!({ "type": "json_schema", "schema": schema });
            }
            let mut beta = vec![];
            if takes_fallback(&engine.model) {
                body["fallbacks"] = json!("default");
                beta.push(("anthropic-beta", "server-side-fallback-2026-07-01"));
            }
            let url = "https://api.anthropic.com/v1/messages";
            let response = match post(engine.provider, url, key, &body, &beta) {
                // Older models don't take an effort level.
                Err(e) if e.to_string().contains("effort") => {
                    body["output_config"].as_object_mut().unwrap().remove("effort");
                    post(engine.provider, url, key, &body, &beta)?
                }
                other => other?,
            };
            match response["stop_reason"].as_str() {
                Some("refusal") => return Err(anyhow!(tr!("cloud_refused"))),
                Some("max_tokens") => return Err(anyhow!(tr!("cloud_too_long"))),
                _ => {}
            }
            let text: String = response["content"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|b| b["type"] == "text")
                .filter_map(|b| b["text"].as_str())
                .collect();
            (text, response["usage"]["output_tokens"].as_u64().unwrap_or(0) as usize)
        }
        Provider::OpenAI => {
            let mut body = json!({
                "model": engine.model,
                "instructions": system,
                "input": [{ "role": "user", "content": format!("{document}{question}") }],
                "max_output_tokens": MAX_TOKENS,
            });
            if let Some(schema) = schema {
                body["text"] = json!({ "format": { "type": "json_schema", "name": "answer", "schema": schema, "strict": true } });
            }
            let response = post(engine.provider, "https://api.openai.com/v1/responses", key, &body, &[])?;
            if response["status"] == "incomplete" {
                return Err(anyhow!(tr!("cloud_too_long")));
            }
            let mut text = String::new();
            for part in response["output"].as_array().into_iter().flatten().filter(|o| o["type"] == "message") {
                for c in part["content"].as_array().into_iter().flatten() {
                    match c["type"].as_str() {
                        Some("output_text") => text.push_str(c["text"].as_str().unwrap_or("")),
                        Some("refusal") => return Err(anyhow!(tr!("cloud_refused"))),
                        _ => {}
                    }
                }
            }
            (text, response["usage"]["output_tokens"].as_u64().unwrap_or(0) as usize)
        }
    };
    if text.trim().is_empty() {
        return Err(anyhow!(tr!("cloud_empty")));
    }
    Ok(Answer { text, generated_tokens: tokens, seconds: t0.elapsed().as_secs_f32() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schemas_are_made_strict() {
        let mut v = json!({
            "type": "object",
            "properties": {
                "items": { "type": "array", "maxItems": 6, "items": {
                    "type": "object", "properties": { "text": {"type": "string"}, "owner": {"type": "string"} }, "required": ["text"]
                } }
            },
            "required": [],
        });
        strict_schema(&mut v);
        assert_eq!(v["additionalProperties"], false);
        assert_eq!(v["required"], json!(["items"]));
        assert!(v["properties"]["items"].get("maxItems").is_none());
        let inner = &v["properties"]["items"]["items"];
        assert_eq!(inner["additionalProperties"], false);
        assert_eq!(inner["required"].as_array().unwrap().len(), 2);
    }
}
