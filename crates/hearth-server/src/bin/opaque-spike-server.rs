//! Opt-in, ephemeral stdio test process. No HTTP endpoints, database, or real accounts.

use std::io::{self, BufRead, Write};

use hearth_crypto::opaque_spike::SpikeServer;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    RegisterStart {
        message: String,
    },
    RegisterFinish {
        message: String,
    },
    LoginStart {
        message: String,
        known_user: bool,
    },
    LoginFinish {
        message: String,
        session_tag: String,
    },
    RecordCheck,
}

fn handle(server: &mut SpikeServer, request: Request) -> Result<Value, String> {
    match request {
        Request::RegisterStart { message } => {
            Ok(json!({ "message": server.registration_start(&message)? }))
        }
        Request::RegisterFinish { message } => {
            server.registration_finish(&message)?;
            Ok(json!({ "registered": true }))
        }
        Request::LoginStart {
            message,
            known_user,
        } => Ok(json!({ "message": server.login_start(&message, known_user)? })),
        Request::LoginFinish {
            message,
            session_tag,
        } => Ok(json!({ "session_matches": server.login_finish(&message, &session_tag)? })),
        Request::RecordCheck => Ok(json!({
            "password_canary_absent": !server.record_contains(b"HEARTH_OPAQUE_PRIVATE_PASSWORD_CANARY")
        })),
    }
}

fn main() -> io::Result<()> {
    let mut server = SpikeServer::default();
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    loop {
        let mut line = String::new();
        if input.read_line(&mut line)? == 0 {
            return Ok(());
        }
        let result = if line.len() <= 16384 {
            serde_json::from_str::<Request>(&line)
                .map_err(|_| "Invalid spike request".into())
                .and_then(|request| handle(&mut server, request))
        } else {
            Err("Invalid spike request".into())
        };
        // Never echo inputs, secrets, or third-party error Debug output.
        let response = match result {
            Ok(value) => json!({ "ok": true, "result": value }),
            Err(_) => json!({ "ok": false, "error": "OPAQUE spike operation rejected" }),
        };
        writeln!(output, "{response}")?;
        output.flush()?;
    }
}
