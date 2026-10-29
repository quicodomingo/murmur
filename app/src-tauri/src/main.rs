// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The Claude connector (mcp.rs): a server on stdin/stdout, no window.
    if std::env::args().any(|a| a == "--mcp") {
        if let Err(e) = transcriptor_lib::mcp::serve() {
            eprintln!("murmur --mcp: {e:#}");
            std::process::exit(1);
        }
        return;
    }
    transcriptor_lib::run()
}
