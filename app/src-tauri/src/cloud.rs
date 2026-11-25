//! The cover written by Claude, OpenAI, Gemini or a model through OpenRouter instead of the local model, with the user's own API key
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
    OpenRouter,
    Gemini,
}

impl Provider {
    fn account(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::OpenAI => "openai",
            Provider::OpenRouter => "openrouter",
            Provider::Gemini => "gemini",
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
    /// The company behind the model, for OpenRouter's long list ("Anthropic").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
}

pub struct Answer {
    pub text: String,
    pub generated_tokens: usize,
    pub seconds: f32,
}

// --- Keychain --------------------------------------------------------------------------------

pub fn key(provider: Provider) -> Result<String> {
    let bytes = crate::keychain::get(SERVICE, provider.account()).ok_or_else(|| anyhow!(tr!("cloud_no_key")))?;
    String::from_utf8(bytes).map_err(|_| anyhow!(tr!("cloud_no_key")))
}

/// Checks the key against the provider (listing its models) and only then saves it.
pub fn connect(provider: Provider, key: &str) -> Result<Vec<CloudModel>> {
    let key = key.trim();
    let models = list_models(provider, key)?;
    crate::keychain::set(SERVICE, provider.account(), key.as_bytes())
        .map_err(|e| anyhow!(tr!("cloud_keychain_failed", error = e)))?;
    Ok(models)
}

pub fn disconnect(provider: Provider) -> Result<()> {
    // Nothing saved means already disconnected (keychain::delete says Ok).
    crate::keychain::delete(SERVICE, provider.account()).map_err(|e| anyhow!(tr!("cloud_keychain_failed", error = e)))
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
        // The app's name, so OpenRouter's activity page says where the calls come from.
        Provider::OpenRouter => req.set("Authorization", &format!("Bearer {key}")).set("X-Title", "Murmur"),
        Provider::Gemini => req.set("x-goog-api-key", key),
    }
}

/// A refused key, with the provider's reason when it gives one.
fn bad_key_error(detail: &str) -> anyhow::Error {
    if detail.is_empty() { anyhow!(tr!("cloud_bad_key")) } else { anyhow!(tr!("cloud_bad_key_said", detail = detail)) }
}

/// A failed call as something the user can act on.
fn failure(e: ureq::Error) -> anyhow::Error {
    match e {
        ureq::Error::Status(code, response) => {
            let body: Value = response.into_json().unwrap_or(Value::Null);
            let detail = body["error"]["message"].as_str().unwrap_or("").to_string();
            let bad_key = detail.contains("API key not valid") || body["error"]["details"].to_string().contains("API_KEY_INVALID");
            // The provider's own words say why (a revoked key, billing, a model not allowed). They
            // never carry the meeting: they go to the log as they are, cut short.
            let short: String = detail.chars().take(200).collect();
            log::warn!("cloud: HTTP {code}{}", if short.is_empty() { String::new() } else { format!(": {short}") });
            match code {
                401 | 403 => bad_key_error(&short),
                400 if bad_key => bad_key_error(&short),
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
                        group: None,
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
                        .then(|| (m["created"].as_i64().unwrap_or(0), CloudModel { id: id.into(), name: id.into(), group: None }))
                })
                .collect();
            models.sort_by(|a, b| b.0.cmp(&a.0));
            Ok(models.into_iter().map(|(_, m)| m).collect())
        }
        Provider::OpenRouter => {
            // The model list is public: ask about the key itself to check it.
            get(provider, "https://openrouter.ai/api/v1/key", key)?;
            let body = get(provider, "https://openrouter.ai/api/v1/models?supported_parameters=structured_outputs", key)?;
            Ok(openrouter_models(&body))
        }
        Provider::Gemini => {
            let body = get(provider, &format!("{GEMINI}/models?pageSize=1000"), key)?;
            Ok(gemini_models(&body))
        }
    }
}

const GEMINI: &str = "https://generativelanguage.googleapis.com/v1beta";

/// Gemini models that write text, newest first (the version is in the name: gemini-4 > gemini-3.5).
fn gemini_models(body: &Value) -> Vec<CloudModel> {
    const NOT_TEXT: [&str; 8] = ["image", "tts", "audio", "live", "embedding", "computer-use", "robotics", "veo"];
    let mut models: Vec<CloudModel> = body["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let id = m["name"].as_str()?.strip_prefix("models/")?;
            let writes = m["supportedGenerationMethods"].as_array().is_some_and(|g| g.iter().any(|g| g == "generateContent"));
            (writes && id.starts_with("gemini-") && !NOT_TEXT.iter().any(|w| id.contains(w)))
                .then(|| CloudModel { id: id.into(), name: m["displayName"].as_str().unwrap_or(id).into(), group: None })
        })
        .collect();
    models.sort_by(|a, b| b.id.cmp(&a.id));
    models
}

/// OpenRouter's models that write text and follow a JSON schema, by company (alphabetically)
/// and newest first within each. Not the ":batch" variants, which answer hours later.
fn openrouter_models(body: &Value) -> Vec<CloudModel> {
    let mut models: Vec<(String, i64, CloudModel)> = body["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let id = m["id"].as_str()?;
            let text_only = m["architecture"]["output_modalities"].as_array().is_none_or(|o| o.len() == 1 && o[0] == "text");
            if !text_only || id.ends_with(":batch") {
                return None;
            }
            let full = m["name"].as_str().unwrap_or(id);
            let (group, name) = full.split_once(": ").unwrap_or(("", full));
            let group = if group.is_empty() { id.split('/').next().unwrap_or(id) } else { group };
            let model = CloudModel { id: id.into(), name: name.trim().into(), group: Some(group.into()) };
            Some((group.to_lowercase(), m["created"].as_i64().unwrap_or(0), model))
        })
        .collect();
    models.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));
    models.into_iter().map(|(_, _, m)| m).collect()
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

fn drop_additional_properties(schema: &mut Value) {
    match schema {
        Value::Object(obj) => {
            obj.remove("additionalProperties");
            obj.values_mut().for_each(drop_additional_properties);
        }
        Value::Array(items) => items.iter_mut().for_each(drop_additional_properties),
        _ => {}
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
        Provider::OpenRouter => {
            // Claude through OpenRouter also reads the document once for the whole cover.
            let content = if engine.model.starts_with("anthropic/") {
                json!([
                    { "type": "text", "text": document, "cache_control": { "type": "ephemeral" } },
                    { "type": "text", "text": question },
                ])
            } else {
                json!(format!("{document}{question}"))
            };
            let mut body = json!({
                "model": engine.model,
                "messages": [{ "role": "system", "content": system }, { "role": "user", "content": content }],
                "max_tokens": MAX_TOKENS,
            });
            if let Some(schema) = schema {
                body["response_format"] = json!({ "type": "json_schema", "json_schema": { "name": "answer", "strict": true, "schema": schema } });
                // Only to the model's hosts that follow the schema, rather than one that ignores it.
                body["provider"] = json!({ "require_parameters": true });
            }
            let response = post(engine.provider, "https://openrouter.ai/api/v1/chat/completions", key, &body, &[])?;
            // A failure on the model's side can come back as a 200 with an error.
            if let Some(message) = response["error"]["message"].as_str() {
                return Err(anyhow!(message.to_string()));
            }
            let choice = &response["choices"][0];
            if let Some(message) = choice["error"]["message"].as_str() {
                return Err(anyhow!(message.to_string()));
            }
            if choice["message"]["refusal"].as_str().is_some_and(|r| !r.is_empty()) {
                return Err(anyhow!(tr!("cloud_refused")));
            }
            if choice["finish_reason"] == "length" {
                return Err(anyhow!(tr!("cloud_too_long")));
            }
            let text = choice["message"]["content"].as_str().unwrap_or("").to_string();
            (text, response["usage"]["completion_tokens"].as_u64().unwrap_or(0) as usize)
        }
        Provider::Gemini => {
            // The document first and the same each time: Gemini's implicit cache reads it once.
            let mut body = json!({
                "systemInstruction": { "parts": [{ "text": system }] },
                "contents": [{ "role": "user", "parts": [{ "text": document }, { "text": question }] }],
                "generationConfig": { "maxOutputTokens": MAX_TOKENS },
            });
            if let Some(mut schema) = schema {
                // Gemini takes a subset of JSON Schema: closed objects are already the default.
                drop_additional_properties(&mut schema);
                body["generationConfig"]["responseMimeType"] = json!("application/json");
                body["generationConfig"]["responseJsonSchema"] = schema;
            }
            let url = format!("{GEMINI}/models/{}:generateContent", engine.model);
            let response = post(engine.provider, &url, key, &body, &[])?;
            if response["promptFeedback"]["blockReason"].is_string() {
                return Err(anyhow!(tr!("cloud_refused")));
            }
            let candidate = &response["candidates"][0];
            match candidate["finishReason"].as_str() {
                Some("MAX_TOKENS") => return Err(anyhow!(tr!("cloud_too_long"))),
                Some("SAFETY" | "PROHIBITED_CONTENT" | "BLOCKLIST" | "SPII" | "RECITATION") => return Err(anyhow!(tr!("cloud_refused"))),
                _ => {}
            }
            // Leave out the model's thoughts, if it shares them.
            let text: String = candidate["content"]["parts"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|p| p["thought"] != true)
                .filter_map(|p| p["text"].as_str())
                .collect();
            (text, response["usageMetadata"]["candidatesTokenCount"].as_u64().unwrap_or(0) as usize)
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

    #[test]
    fn openrouter_models_by_company_newest_first() {
        let body = json!({ "data": [
            { "id": "openai/gpt-x", "name": "OpenAI: GPT X", "created": 5, "architecture": { "output_modalities": ["text"] } },
            { "id": "anthropic/claude-old", "name": "Anthropic: Claude Old", "created": 1, "architecture": { "output_modalities": ["text"] } },
            { "id": "anthropic/claude-new", "name": "Anthropic: Claude New", "created": 9, "architecture": { "output_modalities": ["text"] } },
            { "id": "anthropic/claude-new:batch", "name": "Anthropic: Claude New (batch)", "created": 9 },
            { "id": "google/image", "name": "Google: Image", "created": 7, "architecture": { "output_modalities": ["image", "text"] } },
        ]});
        let models = openrouter_models(&body);
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["anthropic/claude-new", "anthropic/claude-old", "openai/gpt-x"]);
        assert_eq!(models[0].name, "Claude New");
        assert_eq!(models[0].group.as_deref(), Some("Anthropic"));
    }

    #[test]
    fn gemini_text_models_newest_first() {
        let body = json!({ "models": [
            { "name": "models/gemini-3.5-flash", "displayName": "Gemini 3.5 Flash", "supportedGenerationMethods": ["generateContent"] },
            { "name": "models/gemini-4-carbon", "displayName": "Gemini 4 Carbon", "supportedGenerationMethods": ["generateContent", "countTokens"] },
            { "name": "models/gemini-3.1-flash-image", "displayName": "Image", "supportedGenerationMethods": ["generateContent"] },
            { "name": "models/gemini-embedding-001", "supportedGenerationMethods": ["embedContent"] },
            { "name": "models/gemma-4-31b-it", "supportedGenerationMethods": ["generateContent"] },
        ]});
        let ids: Vec<String> = gemini_models(&body).into_iter().map(|m| m.id).collect();
        assert_eq!(ids, ["gemini-4-carbon", "gemini-3.5-flash"]);
    }
}
