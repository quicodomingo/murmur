fn main() {
    let url = std::env::args().nth(1).expect("url");
    let text = ureq::get(&url).call().unwrap().into_string().unwrap();
    println!("{} bytes", text.len());
    let (name, events) = transcriptor_lib::ics::probe(&text, 0.0, 4.0e12);
    println!("name: {name:?}, {} occurrences", events.len());
    for e in events.iter().take(5) {
        println!("  {} · {}", chrono::DateTime::from_timestamp_millis(e.start as i64).unwrap(), e.title);
    }
}
