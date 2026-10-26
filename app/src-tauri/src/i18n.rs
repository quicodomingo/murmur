//! Texts produced by the Rust side (native menus, the tray, alerts and errors shown in the UI) in
//! the interface languages (docs/TRADUCCIONS.md). Catalan is the source.
//!
//! The UI tells us its language with `set_ui_language`; until then, Catalan.
//! `tr!("no_microphone")` looks a text up; `tr!("disk_space", need = …, free = …)` also fills
//! its `{need}` and `{free}`.

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Ca = 0,
    Es = 1,
    En = 2,
}

static LANG: AtomicU8 = AtomicU8::new(Lang::Ca as u8);

/// "ca", "es" or "en"; anything else is ignored. Returns whether the language changed.
pub fn set(code: &str) -> bool {
    let lang = match code {
        "ca" => Lang::Ca,
        "es" => Lang::Es,
        "en" => Lang::En,
        _ => return false,
    };
    LANG.swap(lang as u8, Ordering::Relaxed) != lang as u8
}

pub fn lang() -> Lang {
    match LANG.load(Ordering::Relaxed) {
        1 => Lang::Es,
        2 => Lang::En,
        _ => Lang::Ca,
    }
}

/// The text for `key` in the current language (the key itself if it doesn't exist).
pub fn t(key: &'static str) -> &'static str {
    match strings(key) {
        Some(s) => s[lang() as usize],
        None => {
            debug_assert!(false, "missing text: {key}");
            key
        }
    }
}

/// Replaces each `{name}` in `pattern` with its value.
pub fn fill(pattern: &str, args: &[(&str, &dyn std::fmt::Display)]) -> String {
    let mut out = pattern.to_string();
    for (name, value) in args {
        out = out.replace(&format!("{{{name}}}"), &value.to_string());
    }
    out
}

/// `tr!("key")` → `&'static str`; `tr!("key", name = value, …)` → `String`.
macro_rules! tr {
    ($key:literal) => {
        $crate::i18n::t($key)
    };
    ($key:literal, $($name:ident = $value:expr),+ $(,)?) => {
        $crate::i18n::fill($crate::i18n::t($key), &[$((stringify!($name), &$value as &dyn std::fmt::Display)),+])
    };
}
pub(crate) use tr;

/// [Catalan, Spanish, English].
fn strings(key: &str) -> Option<[&'static str; 3]> {
    Some(match key {
        // App menu and menu bar icon.
        "menu_about" => ["Quant a Murmur", "Acerca de Murmur", "About Murmur"],
        "menu_settings" => ["Configuració…", "Ajustes…", "Settings…"],
        "tray_start" => ["Comença a gravar", "Empezar a grabar", "Start Recording"],
        "tray_stop" => ["Atura la gravació", "Detener la grabación", "Stop Recording"],
        "tray_open" => ["Obre Murmur", "Abrir Murmur", "Open Murmur"],
        "tray_quit" => ["Surt de Murmur", "Salir de Murmur", "Quit Murmur"],
        "tray_recording" => ["Murmur: gravant", "Murmur: grabando", "Murmur: recording"],

        // Alerts. The app's name goes first: dismissed alerts are matched by it.
        "toast_detected" => ["Reunió detectada", "Reunión detectada", "Meeting detected"],
        "toast_mic_user" => ["{name} fa servir el micròfon", "{name} está usando el micrófono", "{name} is using the microphone"],

        // Audio.
        "no_audio_source" => [
            "Activa el micròfon o l'àudio del sistema a la configuració",
            "Activa el micrófono o el audio del sistema en la configuración",
            "Turn on the microphone or system audio in Settings",
        ],
        "system_audio_unsupported" => [
            "L'àudio del sistema encara no està disponible en aquesta plataforma",
            "El audio del sistema aún no está disponible en esta plataforma",
            "System audio isn't available on this platform yet",
        ],
        "no_microphone" => ["No s'ha trobat cap micròfon", "No se ha encontrado ningún micrófono", "No microphone found"],
        "mic_unavailable" => ["El micròfon no està disponible", "El micrófono no está disponible", "The microphone isn't available"],
        "audio_format_unsupported" => [
            "Format d'àudio no suportat: {format}",
            "Formato de audio no compatible: {format}",
            "Unsupported audio format: {format}",
        ],
        "mic_open_failed" => ["No s'ha pogut obrir el micròfon", "No se ha podido abrir el micrófono", "Couldn't open the microphone"],
        "record_start_failed" => ["No s'ha pogut començar a gravar", "No se ha podido empezar a grabar", "Couldn't start recording"],
        "system_audio_create_failed" => [
            "No s'ha pogut crear la captura de l'àudio del sistema",
            "No se ha podido crear la captura del audio del sistema",
            "Couldn't capture system audio",
        ],
        "system_audio_prepare_failed" => [
            "No s'ha pogut preparar l'àudio del sistema",
            "No se ha podido preparar el audio del sistema",
            "Couldn't prepare system audio",
        ],
        "system_audio_read_failed" => [
            "No s'ha pogut llegir l'àudio del sistema",
            "No se ha podido leer el audio del sistema",
            "Couldn't read system audio",
        ],
        "system_audio_start_failed" => [
            "No s'ha pogut començar l'àudio del sistema",
            "No se ha podido iniciar el audio del sistema",
            "Couldn't start system audio",
        ],
        "already_recording" => ["Ja s'està gravant", "Ya se está grabando", "Already recording"],

        // Recording and playback.
        "recordings_dir_failed" => [
            "No s'ha pogut crear la carpeta de gravacions",
            "No se ha podido crear la carpeta de grabaciones",
            "Couldn't create the recordings folder",
        ],
        "audio_file_create_failed" => [
            "No s'ha pogut crear el fitxer d'àudio",
            "No se ha podido crear el archivo de audio",
            "Couldn't create the audio file",
        ],
        "audio_write_failed" => ["No s'ha pogut escriure l'àudio", "No se ha podido escribir el audio", "Couldn't write the audio"],
        "meeting_audio_missing" => [
            "No es troba l'àudio de la reunió",
            "No se encuentra el audio de la reunión",
            "The meeting's audio can't be found",
        ],
        "this_meeting_audio_missing" => [
            "No es troba l'àudio d'aquesta reunió",
            "No se encuentra el audio de esta reunión",
            "This meeting's audio can't be found",
        ],
        "audio_empty" => ["L'àudio és buit", "El audio está vacío", "The audio is empty"],
        "audio_not_opus" => ["L'àudio no és Opus", "El audio no es Opus", "The audio isn't Opus"],
        "audio_convert_failed" => ["No s'ha pogut convertir l'àudio", "No se ha podido convertir el audio", "Couldn't convert the audio"],
        "audio_delete_failed" => [
            "No s'ha pogut eliminar l'àudio: {error}",
            "No se ha podido eliminar el audio: {error}",
            "Couldn't delete the audio: {error}",
        ],
        "audio_save_failed" => [
            "No s'ha pogut desar l'àudio: {error}",
            "No se ha podido guardar el audio: {error}",
            "Couldn't save the audio: {error}",
        ],
        "file_save_failed" => [
            "No s'ha pogut desar el fitxer: {error}",
            "No se ha podido guardar el archivo: {error}",
            "Couldn't save the file: {error}",
        ],

        // Screenshots.
        "capture_failed" => [
            "No s'ha pogut fer la captura. Comprova el permís de Gravació de pantalla.",
            "No se ha podido hacer la captura. Comprueba el permiso de Grabación de pantalla.",
            "Couldn't take the screenshot. Check the Screen Recording permission.",
        ],
        "screen_permission_needed" => [
            "Per fer captures cal el permís de «Gravació de pantalla». Activa Murmur a Configuració del Sistema i torna-ho a provar.",
            "Para hacer capturas hace falta el permiso de «Grabación de pantalla». Activa Murmur en Ajustes del Sistema y vuelve a intentarlo.",
            "Screenshots need the “Screen Recording” permission. Turn on Murmur in System Settings and try again.",
        ],
        "screens_save_failed" => [
            "No s'han pogut desar les captures: {error}",
            "No se han podido guardar las capturas: {error}",
            "Couldn't save the screenshots: {error}",
        ],
        "not_a_capture" => [
            "Aquest fitxer no és una captura de Murmur",
            "Este archivo no es una captura de Murmur",
            "This file isn't a Murmur screenshot",
        ],

        // Meetings and the database.
        "default_meeting_title" => ["Reunió", "Reunión", "Meeting"],
        "unknown_meeting" => ["Reunió desconeguda", "Reunión desconocida", "Unknown meeting"],
        "meeting_not_found" => ["La reunió {id} no existeix", "La reunión {id} no existe", "Meeting {id} doesn't exist"],
        "db_open_failed" => [
            "No s'ha pogut obrir la base de dades",
            "No se ha podido abrir la base de datos",
            "Couldn't open the database",
        ],
        "db_prepare_failed" => [
            "No s'ha pogut preparar la base de dades",
            "No se ha podido preparar la base de datos",
            "Couldn't prepare the database",
        ],
        "db_migrate_failed" => [
            "No s'ha pogut actualitzar la base de dades",
            "No se ha podido actualizar la base de datos",
            "Couldn't update the database",
        ],
        "old_files_archive_failed" => [
            "No s'han pogut arxivar els fitxers antics",
            "No se han podido archivar los archivos antiguos",
            "Couldn't archive the old files",
        ],
        "meetings_read_failed" => [
            "No s'han pogut llegir les reunions",
            "No se han podido leer las reuniones",
            "Couldn't read the meetings",
        ],

        // Models.
        "model_missing" => ["Falta el model {path}", "Falta el modelo {path}", "Model missing: {path}"],
        "speech_model_load_failed" => [
            "No s'ha pogut carregar el model de veu",
            "No se ha podido cargar el modelo de voz",
            "Couldn't load the speech model",
        ],
        "speaker_model_load_failed" => [
            "No s'ha pogut carregar el model de parlants",
            "No se ha podido cargar el modelo de hablantes",
            "Couldn't load the speaker model",
        ],
        "vad_load_failed" => [
            "No s'ha pogut carregar el detector de veu",
            "No se ha podido cargar el detector de voz",
            "Couldn't load the voice detector",
        ],
        "llm_load_failed" => [
            "No s'ha pogut carregar el model de llenguatge",
            "No se ha podido cargar el modelo de lenguaje",
            "Couldn't load the language model",
        ],
        "llm_context_failed" => [
            "No s'ha pogut crear el context del model",
            "No se ha podido crear el contexto del modelo",
            "Couldn't create the model context",
        ],
        // Cover written by Claude or OpenAI (cloud.rs).
        "cloud_no_key" => [
            "Falta la clau d'API: connecta el compte a la configuració",
            "Falta la clave de API: conecta la cuenta en los ajustes",
            "The API key is missing: connect the account in Settings",
        ],
        "cloud_keychain_failed" => [
            "No s'ha pogut desar la clau al clauer: {error}",
            "No se ha podido guardar la clave en el llavero: {error}",
            "Couldn't save the key to the keychain: {error}",
        ],
        "cloud_bad_key" => [
            "La clau d'API no és vàlida o no té permís",
            "La clave de API no es válida o no tiene permiso",
            "The API key isn't valid or lacks permission",
        ],
        "cloud_rate_limited" => [
            "S'ha arribat al límit d'ús del compte. Torna-ho a provar d'aquí a una estona",
            "Se ha llegado al límite de uso de la cuenta. Vuelve a probarlo dentro de un rato",
            "The account's usage limit was reached. Try again in a while",
        ],
        "cloud_unavailable" => [
            "El servei no respon ara mateix (error {code})",
            "El servicio no responde ahora mismo (error {code})",
            "The service isn't responding right now (error {code})",
        ],
        "cloud_offline" => [
            "No s'ha pogut connectar. Comprova la connexió a internet",
            "No se ha podido conectar. Comprueba la conexión a internet",
            "Couldn't connect. Check the internet connection",
        ],
        "cloud_refused" => [
            "El model no ha volgut respondre",
            "El modelo no ha querido responder",
            "The model declined to answer",
        ],
        "cloud_too_long" => [
            "La resposta ha quedat tallada",
            "La respuesta se ha quedado cortada",
            "The answer was cut off",
        ],
        "cloud_empty" => ["Resposta buida", "Respuesta vacía", "Empty answer"],
        "share_not_connected" => [
            "Murmur no està connectat a cap Worker per compartir",
            "Murmur no está conectado a ningún Worker para compartir",
            "Murmur isn't connected to a Worker for sharing",
        ],
        "share_bad_url" => [
            "L'adreça no és vàlida. Ha de ser com https://murmur-share.el-teu-compte.workers.dev",
            "La dirección no es válida. Debe ser como https://murmur-share.tu-cuenta.workers.dev",
            "That address isn't valid. It should look like https://murmur-share.your-account.workers.dev",
        ],
        "share_bad_key" => [
            "El Worker no accepta aquesta clau d'API",
            "El Worker no acepta esta clave de API",
            "The Worker doesn't accept this API key",
        ],
        "share_not_worker" => [
            "En aquesta adreça no hi ha el Worker de Murmur",
            "En esta dirección no está el Worker de Murmur",
            "Murmur's Worker isn't at this address",
        ],
        "share_cf_bad_token" => [
            "Cloudflare no accepta aquest token, o li falten permisos. Crea'l amb l'enllaç de Murmur, que ja els posa",
            "Cloudflare no acepta este token, o le faltan permisos. Créalo con el enlace de Murmur, que ya los pone",
            "Cloudflare doesn't accept this token, or it's missing permissions. Create it with Murmur's link, which sets them",
        ],
        "share_cf_failed" => [
            "Cloudflare ha respost: {error}",
            "Cloudflare ha respondido: {error}",
            "Cloudflare answered: {error}",
        ],
        "share_cf_subdomain" => [
            "No s'ha pogut triar l'adreça workers.dev del compte. Obre Workers al tauler de Cloudflare un cop i torna-ho a provar",
            "No se ha podido elegir la dirección workers.dev de la cuenta. Abre Workers en el panel de Cloudflare una vez y vuelve a intentarlo",
            "Couldn't choose the account's workers.dev address. Open Workers in the Cloudflare dashboard once and try again",
        ],
        "share_not_capture" => [
            "Aquest fitxer no és de la reunió",
            "Este archivo no es de la reunión",
            "That file isn't from this meeting",
        ],
        "share_too_large" => [
            "La reunió és massa gran per compartir-la",
            "La reunión es demasiado grande para compartirla",
            "The meeting is too large to share",
        ],
        "punct_model_missing" => [
            "Falta el model de puntuació {path}",
            "Falta el modelo de puntuación {path}",
            "Punctuation model missing: {path}",
        ],
        "punct_model_load_failed" => [
            "No s'ha pogut carregar el model de puntuació: {error}",
            "No se ha podido cargar el modelo de puntuación: {error}",
            "Couldn't load the punctuation model: {error}",
        ],
        "tokenizer_load_failed" => [
            "No s'ha pogut carregar el tokenitzador: {error}",
            "No se ha podido cargar el tokenizador: {error}",
            "Couldn't load the tokenizer: {error}",
        ],
        "tokenizer" => ["tokenitzador", "tokenizador", "tokenizer"],
        "punct_model" => ["model de puntuació", "modelo de puntuación", "punctuation model"],
        "model_required" => [
            "Murmur necessita aquest model per transcriure",
            "Murmur necesita este modelo para transcribir",
            "Murmur needs this model to transcribe",
        ],
        "stop_download_first" => ["Primer atura la descàrrega", "Primero detén la descarga", "Stop the download first"],
        "catalog_model_gone" => [
            "El catàleg ja no té aquest model",
            "El catálogo ya no tiene este modelo",
            "The catalog no longer has this model",
        ],
        "model_not_downloadable" => [
            "Aquest model encara no es pot descarregar",
            "Este modelo aún no se puede descargar",
            "This model can't be downloaded yet",
        ],
        "catalog_unknown_file" => [
            "El catàleg porta un fitxer que aquesta versió de Murmur no coneix: {name}",
            "El catálogo incluye un archivo que esta versión de Murmur no conoce: {name}",
            "The catalog has a file this version of Murmur doesn't know: {name}",
        ],
        "install_failed" => ["No s'ha pogut instal·lar {name}", "No se ha podido instalar {name}", "Couldn't install {name}"],
        "delete_failed" => ["No s'ha pogut esborrar {path}", "No se ha podido borrar {path}", "Couldn't delete {path}"],
        "disk_space" => [
            "No hi ha prou espai al disc: calen {need} GB i n'hi ha {free} GB lliures",
            "No hay suficiente espacio en el disco: hacen falta {need} GB y hay {free} GB libres",
            "Not enough disk space: {need} GB needed and {free} GB free",
        ],
        "server_status" => ["El servidor ha respost {code}", "El servidor ha respondido {code}", "The server responded {code}"],
        "connect_failed" => ["No s'ha pogut connectar: {error}", "No se ha podido conectar: {error}", "Couldn't connect: {error}"],
        "model_write_failed" => ["No s'ha pogut escriure el model", "No se ha podido escribir el modelo", "Couldn't write the model"],
        "download_interrupted" => ["La descàrrega s'ha interromput", "La descarga se ha interrumpido", "The download was interrupted"],
        "download_incomplete" => [
            "Descàrrega incompleta ({have} de {total} bytes)",
            "Descarga incompleta ({have} de {total} bytes)",
            "Incomplete download ({have} of {total} bytes)",
        ],
        "checksum_mismatch" => [
            "El fitxer descarregat no és correcte (la suma de comprovació no coincideix). Torna-ho a provar.",
            "El archivo descargado no es correcto (la suma de comprobación no coincide). Vuelve a intentarlo.",
            "The downloaded file isn't correct (the checksum doesn't match). Try again.",
        ],
        "catalog_fetch_failed" => [
            "No s'ha pogut consultar el catàleg de models: {error}",
            "No se ha podido consultar el catálogo de modelos: {error}",
            "Couldn't check the model catalog: {error}",
        ],
        "catalog_invalid" => ["El catàleg de models no és vàlid", "El catálogo de modelos no es válido", "The model catalog isn't valid"],

        // Final pass.
        "speaker_check_failed" => [
            "La verificació de parlants ha fallat",
            "La verificación de hablantes ha fallado",
            "Speaker verification failed",
        ],
        "speaker_check_error" => [
            "No s'han pogut verificar els parlants: {error}",
            "No se han podido verificar los hablantes: {error}",
            "Couldn't verify the speakers: {error}",
        ],
        "final_pass_error" => [
            "No s'ha pogut millorar la transcripció: {error}",
            "No se ha podido mejorar la transcripción: {error}",
            "Couldn't improve the transcript: {error}",
        ],
        "whisper_start_failed" => [
            "No s'ha pogut obrir murmur-whisper",
            "No se ha podido abrir murmur-whisper",
            "Couldn't start murmur-whisper",
        ],
        "whisper_bad_reply" => [
            "murmur-whisper ha respost malament",
            "murmur-whisper ha respondido mal",
            "murmur-whisper gave an invalid response",
        ],
        "whisper_failed" => ["Whisper ha fallat: {error}", "Whisper ha fallado: {error}", "Whisper failed: {error}"],
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_and_switches() {
        let free = 1.5;
        assert_eq!(tr!("disk_space", need = "2.0", free = format!("{free:.1}")), "No hi ha prou espai al disc: calen 2.0 GB i n'hi ha 1.5 GB lliures");
        set("en");
        assert_eq!(tr!("tray_start"), "Start Recording");
        set("ca");
        assert_eq!(tr!("tray_start"), "Comença a gravar");
        assert!(!set("fr"));
    }

    #[test]
    fn no_em_dashes() {
        assert!(!include_str!("i18n.rs").contains('\u{2014}'));
    }
}
