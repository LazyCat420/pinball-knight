//! Dump a unary sweep's raw f64 bits, to diff against the JS runtime PER INPUT.
//!
//! The oracle digest says "this curve is wrong". This says which x. Pair with
//! `legacy/scripts/dump-trig-sweep.mjs`, which writes the same layout from node:
//!
//! ```text
//!   node legacy/scripts/dump-trig-sweep.mjs cos 0 20 200000 /tmp/node.bin
//!   cargo run -p pk-core --example dump_unary -- js_cos 0 20 200000 /tmp/rust.bin
//!   node legacy/scripts/dump-trig-sweep.mjs --diff cos 0 20 200000 /tmp/node.bin /tmp/rust.bin
//! ```
//!
//! Kept as an example rather than a test because it is a debugging instrument:
//! nothing gates on it, and it writes wherever you point it.

use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 6 {
        eprintln!("usage: dump_unary <fn> <from> <to> <n> <out.bin>");
        eprintln!("  fn: js_cos js_sin libm_cos libm_sin std_cos std_sin");
        std::process::exit(2);
    }
    let f: fn(f64) -> f64 = match args[1].as_str() {
        "js_cos" => pk_core::jsmath::js_cos,
        "js_sin" => pk_core::jsmath::js_sin,
        "libm_cos" => libm::cos,
        "libm_sin" => libm::sin,
        "std_cos" => f64::cos,
        "std_sin" => f64::sin,
        other => panic!("unknown fn {other}"),
    };
    let from: f64 = args[2].parse().unwrap();
    let to: f64 = args[3].parse().unwrap();
    let n: u32 = args[4].parse().unwrap();

    let mut out = Vec::with_capacity((n as usize + 1) * 8);
    for k in 0..=n {
        let x = from + (to - from) * f64::from(k) / f64::from(n);
        out.extend_from_slice(&f(x).to_bits().to_le_bytes());
    }
    let mut file = std::fs::File::create(&args[5]).unwrap();
    file.write_all(&out).unwrap();
}
