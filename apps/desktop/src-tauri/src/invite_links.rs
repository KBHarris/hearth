//! OS links are untrusted input. Keep one bounded, expiring handoff in memory only.
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Default)]
pub struct PendingInvite(Mutex<Option<(Instant, String)>>);

impl PendingInvite {
    pub fn receive(&self, input: &str) {
        if !valid_link(input) {
            return;
        }
        if let Ok(mut pending) = self.0.lock() {
            *pending = Some((Instant::now(), input.to_owned()));
        }
    }

    fn take(&self) -> Option<String> {
        let (received, value) = self.0.lock().ok()?.take()?;
        (received.elapsed() < Duration::from_secs(300)).then_some(value)
    }
}

fn valid_link(input: &str) -> bool {
    if input.len() > 2048 || input.chars().any(char::is_control) {
        return false;
    }
    let Ok(url) = tauri::Url::parse(input) else {
        return false;
    };
    url.scheme() == "hearth"
        && url.host_str() == Some("join")
        && url.path() == "/"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.query().is_none()
        && url.fragment().is_some_and(|fragment| !fragment.is_empty())
}

#[tauri::command]
pub fn take_invite_link(state: tauri::State<'_, PendingInvite>) -> Option<String> {
    state.take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn untrusted_os_links_are_bounded_consumed_and_expire() {
        let state = PendingInvite::default();
        let link = "hearth://join/#v=2&server=https%3A%2F%2Fexample.org&code=TEST";
        for invalid in [
            "https://example.org/",
            "hearth://other/#test",
            "hearth://join/?code=secret#test",
            "hearth://user@join/#test",
            "hearth://join/#test\n",
        ] {
            state.receive(invalid);
            assert!(state.take().is_none());
        }
        state.receive(&format!("hearth://join/#{}", "x".repeat(2048)));
        assert!(state.take().is_none());
        state.receive(link);
        assert_eq!(state.take().as_deref(), Some(link));
        assert!(state.take().is_none());
        *state.0.lock().unwrap() = Some((Instant::now() - Duration::from_secs(301), link.into()));
        assert!(state.take().is_none());
    }
}
