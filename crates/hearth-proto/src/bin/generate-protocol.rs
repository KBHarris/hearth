use std::{error::Error, path::Path, process::ExitCode};

fn run() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let check = match args.as_slice() {
        [] => false,
        [flag] if flag == "--check" => true,
        _ => return Err("usage: generate-protocol [--check]".into()),
    };
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/sdk/src/protocol.ts");
    let generated = hearth_proto::typescript::generate();
    if check {
        let current = std::fs::read_to_string(path)?.replace("\r\n", "\n");
        if current != generated {
            return Err("protocol.ts is out of date; run npm run protocol:generate".into());
        }
        println!("Protocol types are current.");
    } else {
        std::fs::write(path, generated)?;
        println!("Generated packages/sdk/src/protocol.ts");
    }
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
