fn main() {
    bundled_libs();
    google_oauth();
    tauri_build::build()
}

/// Google Calendar's OAuth client (google.rs), baked in when there is one: from
/// `MURMUR_GOOGLE_CLIENT_ID` and `MURMUR_GOOGLE_CLIENT_SECRET` (the release, from the repository's
/// secrets), or from `google-oauth.json`, the file Google Cloud gives (local builds; not in the
/// repository). Without it the app builds the same, with no Google sign-in: forks, test builds.
/// A desktop app's client secret can't stay secret (Google says so for installed apps): it's kept
/// out of the public code only so that it isn't copied as is.
fn google_oauth() {
    println!("cargo:rerun-if-env-changed=MURMUR_GOOGLE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=MURMUR_GOOGLE_CLIENT_SECRET");
    let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("google-oauth.json");
    println!("cargo:rerun-if-changed={}", file.display());
    let from_env = std::env::var("MURMUR_GOOGLE_CLIENT_ID").ok().zip(std::env::var("MURMUR_GOOGLE_CLIENT_SECRET").ok());
    let from_file = || {
        let json: serde_json::Value = serde_json::from_slice(&std::fs::read(&file).ok()?).ok()?;
        let client = json.get("installed")?;
        Some((client["client_id"].as_str()?.to_string(), client["client_secret"].as_str()?.to_string()))
    };
    if let Some((id, secret)) = from_env.filter(|(id, secret)| !id.is_empty() && !secret.is_empty()).or_else(from_file) {
        println!("cargo:rustc-env=MURMUR_GOOGLE_CLIENT_ID={id}");
        println!("cargo:rustc-env=MURMUR_GOOGLE_CLIENT_SECRET={secret}");
    }
}

/// Windows and Linux: sherpa-onnx comes as shared libraries (Cargo.toml says why), which
/// sherpa-onnx-sys unpacks into target/sherpa-onnx-prebuilt and copies next to the executable in
/// target/<profile>. Its build script has already run: it's a direct dependency with `links`.
///
/// The installers take them from `windows-dlls/` or `linux-libs/` (resources in
/// tauri.windows.conf.json and tauri.linux.conf.json), copied here first, whatever the profile
/// and target. On Windows they end up next to Murmur's .exe; on Linux in /usr/lib/Murmur (the
/// .deb and .rpm) or usr/lib/Murmur (the AppImage), which the executable's rpath points to.
fn bundled_libs() {
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let (folder, wanted): (&str, fn(&str) -> bool) = match os.as_str() {
        "windows" => ("windows-dlls", |name| name.to_ascii_lowercase().ends_with(".dll")),
        "linux" => ("linux-libs", |name| name.contains(".so")),
        _ => return,
    };
    if os == "linux" {
        // Next to the executable (target/<profile>, during development), or the package's lib folder.
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN:$ORIGIN/../lib/Murmur");
    }
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    // OUT_DIR is target/<profile>/build/<crate>-<hash>/out.
    let Some(profile) = out.ancestors().nth(3) else { return };
    let dest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(folder);
    std::fs::create_dir_all(&dest).unwrap();
    let mut dirs = vec![];
    for target in profile.ancestors().skip(1).take(2) {
        let prebuilt = target.join("sherpa-onnx-prebuilt");
        if prebuilt.is_dir() {
            dirs.push(prebuilt);
        }
    }
    let mut found = 0;
    while let Some(dir) = dirs.pop() {
        for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if path.is_dir() {
                dirs.push(path);
            } else if wanted(&name) {
                // Following links: libonnxruntime.so and its versioned name are both real files.
                std::fs::copy(&path, dest.join(&name)).unwrap();
                found += 1;
            }
        }
    }
    if found == 0 {
        println!("cargo:warning=No s'han trobat les biblioteques de sherpa-onnx per a {}", dest.display());
    }
    if std::env::var_os("CARGO_FEATURE_VULKAN").is_some() {
        vulkan_loader(&os, &dest);
    }
    if os == "windows" && std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("aarch64") {
        libomp(&dest);
    }
}

/// Windows ARM: llama.cpp is built with clang-cl (.github/scripts/msvc-ninja.ps1), and with
/// OpenMP, which llama-cpp-sys always turns on. cl.exe brings its own runtime (vcomp); clang-cl
/// needs LLVM's libomp, linked here and shipped next to the executable. `MURMUR_LLVM_DIR` says
/// where LLVM is, if not in its usual folder.
fn libomp(dest: &std::path::Path) {
    println!("cargo:rerun-if-env-changed=MURMUR_LLVM_DIR");
    let llvm = std::env::var_os("MURMUR_LLVM_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| "C:\\Program Files\\LLVM".into());
    let dll = llvm.join("bin").join("libomp.dll");
    if !dll.is_file() || !llvm.join("lib").join("libomp.lib").is_file() {
        panic!("Falta libomp de LLVM a {} (MURMUR_LLVM_DIR)", llvm.display());
    }
    println!("cargo:rustc-link-search=native={}", llvm.join("lib").display());
    println!("cargo:rustc-link-lib=dylib=libomp");
    std::fs::copy(&dll, dest.join("libomp.dll")).unwrap();
}

/// With `vulkan`, llama.cpp (here) and whisper.cpp (murmur-whisper) link against the Vulkan
/// loader, and without it neither would even start. GPU drivers install it, but not every PC
/// has one (a virtual machine, a PC without drivers), so it goes in the installer too. With no
/// Vulkan driver behind it, ggml finds no device and everything runs on the CPU.
///
/// `MURMUR_VULKAN_LOADER` says which file to take; otherwise, the Vulkan SDK's or the system's.
fn vulkan_loader(os: &str, dest: &std::path::Path) {
    use std::path::PathBuf;
    println!("cargo:rerun-if-env-changed=MURMUR_VULKAN_LOADER");
    println!("cargo:rerun-if-env-changed=VULKAN_SDK");
    let name = if os == "windows" { "vulkan-1.dll" } else { "libvulkan.so.1" };
    let mut candidates: Vec<PathBuf> = vec![];
    if let Some(path) = std::env::var_os("MURMUR_VULKAN_LOADER") {
        candidates.push(path.into());
    }
    if let Some(sdk) = std::env::var_os("VULKAN_SDK").map(PathBuf::from) {
        candidates.extend([sdk.join("Bin").join(name), sdk.join("lib").join(name)]);
    }
    if os == "windows" {
        let windir = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| "C:\\Windows".into());
        candidates.push(windir.join("System32").join(name));
    } else {
        let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
        candidates.extend([
            PathBuf::from(format!("/usr/lib/{arch}-linux-gnu/{name}")),
            PathBuf::from(format!("/usr/lib64/{name}")),
            PathBuf::from(format!("/usr/lib/{name}")),
        ]);
    }
    let Some(loader) = candidates.iter().find(|p| p.is_file()) else {
        panic!("Falta el carregador de Vulkan ({name}): instal·la el Vulkan SDK o posa MURMUR_VULKAN_LOADER");
    };
    // Following links: libvulkan.so.1 is usually a link to the versioned file.
    std::fs::copy(loader, dest.join(name)).unwrap();
}
