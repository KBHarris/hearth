//! Activity state is authenticated and reduced only on clients, never on hosts.
use super::*;
use hearth_proto::activity::*;

fn title(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 160 && !value.chars().any(char::is_control)
}
fn position(value: &PlaybackPosition) -> bool {
    value.revision > 0 && value.position_ms <= 86_400_000 && value.sent_at < 9_007_199_254_740_991
}
pub(super) fn validate(value: &Activity) -> Result<(), String> {
    require(match value {
        Activity::Event { event } => {
            title(&event.title)
                && event.description.len() <= 4000
                && event.location.len() <= 200
                && !event.location.chars().any(char::is_control)
                && event.starts_at < event.ends_at
                && event.ends_at < 9_007_199_254_740_991
                && event.ends_at - event.starts_at <= 7 * 86_400_000
        }
        Activity::EventCancel { id } | Activity::Rsvp { id, .. } => valid_id(id),
        Activity::Playback { playback } => {
            title(&playback.title)
                && position(&playback.position)
                && valid_url(playback.provider, &playback.url)
        }
        Activity::PlaybackUpdate {
            id,
            position: state,
        } => valid_id(id) && position(state),
    })
}
fn valid_url(provider: PlaybackProvider, url: &str) -> bool {
    let identifier = match provider {
        PlaybackProvider::Youtube => url
            .strip_prefix("https://www.youtube.com/watch?v=")
            .filter(|id| id.len() == 11)
            .map(|id| {
                id.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
            }),
        PlaybackProvider::Spotify => url
            .strip_prefix("https://open.spotify.com/track/")
            .or_else(|| url.strip_prefix("https://open.spotify.com/episode/"))
            .filter(|id| id.len() == 22)
            .map(|id| id.bytes().all(|b| b.is_ascii_alphanumeric())),
        PlaybackProvider::Soundcloud => url
            .strip_prefix("https://soundcloud.com/")
            .filter(|id| {
                id.len() <= 160
                    && id.split('/').count() == 2
                    && id.split('/').all(|part| !part.is_empty())
            })
            .map(|id| {
                id.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_/".contains(&b))
            }),
    };
    identifier == Some(true)
}
pub(super) fn metadata(value: &Activity) -> (MessageAction, Option<String>) {
    match value {
        Activity::Event { .. } | Activity::Playback { .. } => (MessageAction::Send, None),
        Activity::Rsvp { id, .. } => (MessageAction::Reaction, Some(id.clone())),
        Activity::EventCancel { id } | Activity::PlaybackUpdate { id, .. } => {
            (MessageAction::Edit, Some(id.clone()))
        }
    }
}
impl Messaging {
    pub(super) fn check_activity(&self, group: &str, activity: &Activity) -> Result<(), String> {
        validate(activity)?;
        let (_, target) = metadata(activity);
        if let Some(id) = target {
            let message = self
                .state
                .messages
                .iter()
                .find(|m| m.id == id && m.conversation_id == group && !m.deleted)
                .ok_or(ERROR)?;
            match activity {
                Activity::Rsvp { .. } => {
                    require(message.event.as_ref().is_some_and(|event| !event.cancelled))
                }
                Activity::EventCancel { .. } => require(
                    message.author_id == self.own.account_id
                        && message.event.as_ref().is_some_and(|event| !event.cancelled),
                ),
                Activity::PlaybackUpdate { position, .. } => require(
                    message.author_id == self.own.account_id
                        && message
                            .playback
                            .as_ref()
                            .is_some_and(|playback| position.revision > playback.position.revision),
                ),
                _ => Ok(()),
            }
        } else {
            Ok(())
        }
    }
    pub(super) fn apply_activity(
        &mut self,
        group: &str,
        operation: &str,
        author: &str,
        activity: Activity,
    ) -> Result<(), String> {
        match activity {
            Activity::Event { event } => {
                self.apply(
                    group,
                    operation,
                    author,
                    MessageContent::Text {
                        text: event.title.clone(),
                        reply_to: None,
                    },
                )?;
                self.state.messages.last_mut().ok_or(ERROR)?.event = Some(LocalEvent {
                    event,
                    cancelled: false,
                    rsvps: BTreeMap::new(),
                });
            }
            Activity::Playback { playback } => {
                self.apply(
                    group,
                    operation,
                    author,
                    MessageContent::Text {
                        text: playback.title.clone(),
                        reply_to: None,
                    },
                )?;
                self.state.messages.last_mut().ok_or(ERROR)?.playback = Some(playback);
            }
            Activity::Rsvp { id, response } => {
                if let Some(event) = self
                    .state
                    .messages
                    .iter_mut()
                    .find(|m| m.id == id && m.conversation_id == group && !m.deleted)
                    .and_then(|m| m.event.as_mut())
                    .filter(|event| !event.cancelled)
                    && (event.rsvps.len() < 128 || event.rsvps.contains_key(author))
                {
                    event.rsvps.insert(author.into(), response);
                }
            }
            Activity::EventCancel { id } => {
                if let Some(event) = self
                    .state
                    .messages
                    .iter_mut()
                    .find(|m| {
                        m.id == id
                            && m.conversation_id == group
                            && !m.deleted
                            && m.author_id == author
                    })
                    .and_then(|m| m.event.as_mut())
                {
                    event.cancelled = true;
                }
            }
            Activity::PlaybackUpdate { id, position } => {
                if let Some(playback) = self
                    .state
                    .messages
                    .iter_mut()
                    .find(|m| {
                        m.id == id
                            && m.conversation_id == group
                            && !m.deleted
                            && m.author_id == author
                    })
                    .and_then(|m| m.playback.as_mut())
                    .filter(|playback| position.revision > playback.position.revision)
                {
                    playback.position = position;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scheduled_events_round_trip_through_mls_and_sealed_storage() {
        let server = random_id();
        let group = random_id();
        let alice_identity = LocalIdentity::new();
        let alice_account = random_id();
        let mut alice = Messaging::new(&alice_identity, &alice_account, &server).unwrap();
        let mut bob = Messaging::new(&LocalIdentity::new(), &random_id(), &server).unwrap();
        let package = bob.key_package().unwrap();
        let commit = alice.add(&group, &[package], true).unwrap();
        alice.accept(&commit.operation_id).unwrap();
        bob.receive(&DeliveryEvent {
            seq: 1,
            conversation_id: group.clone(),
            data: DeliveryData::Welcome {
                welcome: commit.welcomes[0].clone(),
                upload: commit,
            },
        })
        .unwrap();
        let event = ScheduledEvent {
            title: "HEARTH_EVENT_TITLE_CANARY".into(),
            description: "HEARTH_EVENT_DESCRIPTION_CANARY".into(),
            location: "Private room".into(),
            starts_at: 1000,
            ends_at: 2000,
        };
        let upload = alice
            .send(
                &group,
                MessageContent::Activity {
                    activity: Activity::Event { event },
                },
            )
            .unwrap();
        let id = upload.operation_id.clone();
        let bytes = hex::decode(&upload.ciphertext).unwrap();
        assert!(!bytes.windows(12).any(|part| part == b"HEARTH_EVENT"));
        alice.accept(&id).unwrap();
        bob.receive(&DeliveryEvent {
            seq: 2,
            conversation_id: group.clone(),
            data: DeliveryData::Message { upload },
        })
        .unwrap();
        assert_eq!(
            bob.view().unwrap().messages[0]
                .event
                .as_ref()
                .unwrap()
                .event
                .title,
            "HEARTH_EVENT_TITLE_CANARY"
        );
        assert!(
            bob.send(
                &group,
                MessageContent::Activity {
                    activity: Activity::EventCancel { id: id.clone() }
                }
            )
            .is_err()
        );
        let response = bob
            .send(
                &group,
                MessageContent::Activity {
                    activity: Activity::Rsvp {
                        id: id.clone(),
                        response: Rsvp::Going,
                    },
                },
            )
            .unwrap();
        bob.accept(&response.operation_id).unwrap();
        alice
            .receive(&DeliveryEvent {
                seq: 1,
                conversation_id: group.clone(),
                data: DeliveryData::Message { upload: response },
            })
            .unwrap();
        let reopened = Messaging::open(
            &alice_identity,
            &alice_account,
            &server,
            &alice.seal().unwrap(),
        )
        .unwrap();
        assert!(
            reopened.state.messages[0]
                .event
                .as_ref()
                .unwrap()
                .rsvps
                .get(&bob.own.account_id)
                == Some(&Rsvp::Going)
        );
    }
    #[test]
    fn provider_addresses_are_canonical_and_cannot_carry_identity_or_capabilities() {
        for (provider, good) in [
            (
                PlaybackProvider::Youtube,
                "https://www.youtube.com/watch?v=abcdefghijk",
            ),
            (
                PlaybackProvider::Spotify,
                "https://open.spotify.com/track/1234567890123456789012",
            ),
            (
                PlaybackProvider::Soundcloud,
                "https://soundcloud.com/artist/track",
            ),
        ] {
            assert!(valid_url(provider, good));
            for suffix in [
                "?token=secret",
                "#invite",
                "&redirect=https://evil.example",
                "/../private",
            ] {
                assert!(!valid_url(provider, &format!("{good}{suffix}")));
            }
        }
        assert!(!valid_url(
            PlaybackProvider::Youtube,
            "https://youtube.com.evil.example/watch?v=abcdefghijk"
        ));
    }
    #[test]
    fn activity_reduction_binds_control_to_creator_and_rsvp_to_authenticated_author() {
        let mut client = Messaging::new(&LocalIdentity::new(), &random_id(), &random_id()).unwrap();
        let group = random_id();
        let owner = client.own.account_id.clone();
        let peer = random_id();
        let id = random_id();
        let event = ScheduledEvent {
            title: "Encrypted event canary".into(),
            description: "Private description".into(),
            starts_at: 1000,
            ends_at: 2000,
            location: "Our room".into(),
        };
        client
            .apply_activity(&group, &id, &owner, Activity::Event { event })
            .unwrap();
        client
            .apply_activity(
                &group,
                &random_id(),
                &peer,
                Activity::EventCancel { id: id.clone() },
            )
            .unwrap();
        assert!(!client.state.messages[0].event.as_ref().unwrap().cancelled);
        client
            .apply_activity(
                &group,
                &random_id(),
                &peer,
                Activity::Rsvp {
                    id: id.clone(),
                    response: Rsvp::Going,
                },
            )
            .unwrap();
        assert!(
            client.state.messages[0]
                .event
                .as_ref()
                .unwrap()
                .rsvps
                .get(&peer)
                == Some(&Rsvp::Going)
        );
        client
            .apply_activity(
                &group,
                &random_id(),
                &owner,
                Activity::EventCancel { id: id.clone() },
            )
            .unwrap();
        assert!(
            client
                .check_activity(
                    &group,
                    &Activity::Rsvp {
                        id,
                        response: Rsvp::Interested
                    }
                )
                .is_err()
        );
        let id = random_id();
        let playback = SharedPlayback {
            title: "Together".into(),
            provider: PlaybackProvider::Youtube,
            url: "https://www.youtube.com/watch?v=abcdefghijk".into(),
            position: PlaybackPosition {
                revision: 1,
                playing: false,
                position_ms: 0,
                sent_at: 0,
            },
        };
        client
            .apply_activity(&group, &id, &owner, Activity::Playback { playback })
            .unwrap();
        for (author, revision) in [(&peer, 3), (&owner, 2), (&owner, 1)] {
            client
                .apply_activity(
                    &group,
                    &random_id(),
                    author,
                    Activity::PlaybackUpdate {
                        id: id.clone(),
                        position: PlaybackPosition {
                            revision,
                            playing: true,
                            position_ms: revision * 1000,
                            sent_at: 0,
                        },
                    },
                )
                .unwrap();
        }
        assert_eq!(
            client.state.messages[1]
                .playback
                .as_ref()
                .unwrap()
                .position
                .revision,
            2
        );
    }
}
