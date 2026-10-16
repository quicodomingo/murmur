//! Prints the microphone and system audio permissions of this process.
fn main() {
    println!("{:?}", transcriptor_lib::permissions::status());
}
