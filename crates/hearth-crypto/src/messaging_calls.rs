//! Call controls bind approved devices to a live private MLS conversation.
use super::*;

pub(super) fn validate(signal: &CallSignal) -> Result<(), String> {
    require(
        valid_id(&signal.call_id)
            && valid_id(&signal.from_device)
            && valid_id(&signal.to_device)
            && signal.from_device != signal.to_device
            && signal.epoch < 9_007_199_254_740_991
            && signal.expires_at < 9_007_199_254_740_991
            && match (&signal.group_id, &signal.participants) {
                (None, None) => !signal.kind.starts_with("group-"),
                (Some(id), Some(peers)) => {
                    valid_id(id)
                        && if signal.voice_room.is_some() {
                            (2..=if signal.kind.starts_with("sfu-") {
                                25
                            } else {
                                4
                            })
                                .contains(&peers.len())
                        } else {
                            peers.len() == 3
                        }
                        && peers.iter().all(|key| valid_id(key))
                        && peers.windows(2).all(|pair| pair[0] < pair[1])
                        && peers.contains(&signal.from_device)
                        && peers.contains(&signal.to_device)
                        && (!(signal.kind.starts_with("group-")
                            || signal.kind.starts_with("room-")
                            || signal.kind.starts_with("sfu-"))
                            || signal.call_id == *id)
                }
                _ => false,
            }
            && signal.voice_room.as_ref().is_none_or(|room| {
                valid_id(room) && signal.group_id.is_some() && !signal.kind.starts_with("group-")
            })
            && (signal.voice_room.is_some() || !signal.kind.starts_with("room-"))
            && (signal.voice_room.is_some() || !signal.kind.starts_with("sfu-"))
            && match signal.kind.as_str() {
                "offer" | "answer" => signal
                    .description
                    .as_ref()
                    .is_some_and(|s| !s.is_empty() && s.len() <= 48_000),
                "hangup" | "heartbeat" => signal.description.is_none(),
                // Counter and camera/screen flags are encrypted MLS state, not
                // host-visible presence metadata. Null remains a valid audio-only
                // heartbeat; it never supersedes a versioned media state.
                "room-heartbeat" | "sfu-heartbeat" | "group-heartbeat" => {
                    signal.description.as_ref().is_none_or(|state| {
                        (state.len() == 11 || state.len() == 12)
                            && state.as_bytes()[..8].iter().all(u8::is_ascii_digit)
                            && state[..8].parse::<u32>().is_ok_and(|n| n > 0)
                            && state.as_bytes()[8] == b':'
                            && state.as_bytes()[9..]
                                .iter()
                                .all(|b| matches!(b, b'0' | b'1'))
                    })
                }
                "sfu-key" => signal.description.as_ref().is_some_and(|text| {
                    if text.len() > 8192 {
                        return false;
                    }
                    let Ok(keys) =
                        serde_json::from_str::<Vec<hearth_proto::voice::WrappedMediaKey>>(text)
                    else {
                        return false;
                    };
                    let Some(peers) = &signal.participants else {
                        return false;
                    };
                    let wanted = peers
                        .iter()
                        .filter(|peer| **peer != signal.from_device)
                        .collect::<Vec<_>>();
                    keys.len() == wanted.len()
                        && keys.iter().zip(wanted).all(|(key, peer)| {
                            key.recipient == *peer
                                && key.nonce.len() == 24
                                && key.ciphertext.len() == 96
                                && key
                                    .nonce
                                    .bytes()
                                    .chain(key.ciphertext.bytes())
                                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                        })
                }),
                "group-invite" | "group-join" | "group-decline" | "group-leave" | "group-ready"
                | "group-start" => signal.description.is_none(),
                "group-key" => signal.description.as_ref().is_some_and(|key| {
                    key.len() == 130
                        && key.starts_with("04")
                        && key
                            .bytes()
                            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                }),
                // Two-digit participation round, state and uncompressed P-256
                // contribution. Leave dominates join within a round; clients
                // require a higher round and fresh consent to rejoin.
                "group-member" => signal.description.as_ref().is_some_and(|member| {
                    let fields: Vec<_> = member.split(':').collect();
                    fields.len() == 3
                        && fields[0].len() == 2
                        && fields[0].bytes().all(|b| b.is_ascii_digit())
                        && fields[0].parse::<u8>().is_ok_and(|n| (1..=32).contains(&n))
                        && matches!(fields[1], "joined" | "left")
                        && fields[2].len() == 130
                        && fields[2].starts_with("04")
                        && fields[2]
                            .bytes()
                            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                }),
                "key-offer" | "key-ready" | "key-commit" | "key-done" => {
                    signal.description.as_ref().is_some_and(|id| valid_id(id))
                }
                _ => false,
            },
    )
}

impl Messaging {
    pub(super) fn verify_call_epoch(
        &self,
        id: &str,
        signal: &CallSignal,
        sender: &str,
        epoch: u64,
    ) -> Result<(), String> {
        validate(signal)?;
        require(signal.from_device == sender && signal.epoch == epoch)?;
        let channel = self.state.channels.get(id);
        require(channel.is_some() == signal.voice_room.is_some())?;
        // Old-epoch envelopes must still advance delivery, but cannot start a live call.
        let peers = match self.state.epoch_rosters.get(id).and_then(|r| r.get(&epoch)) {
            Some(peers) => peers.clone(),
            None => self
                .groups
                .get(id)
                .ok_or(ERROR)?
                .members()
                .map(|leaf| self.verified_member(&leaf.credential, &leaf.signature_key))
                .collect::<Result<Vec<_>, _>>()?,
        };
        let from = peers
            .iter()
            .find(|m| m.enrollment.device_key == signal.from_device)
            .ok_or(ERROR)?;
        let to = peers
            .iter()
            .find(|m| m.enrollment.device_key == signal.to_device)
            .ok_or(ERROR)?;
        let accounts: std::collections::BTreeSet<_> = peers.iter().map(|m| &m.account_id).collect();
        require(from.account_id != to.account_id)?;
        if let Some(selected) = &signal.participants {
            let selected_accounts = selected
                .iter()
                .map(|key| {
                    peers
                        .iter()
                        .find(|peer| peer.enrollment.device_key == *key)
                        .map(|peer| &peer.account_id)
                })
                .collect::<Option<std::collections::BTreeSet<_>>>()
                .ok_or(ERROR)?;
            if let Some(auth) = channel {
                require(auth.policy.kind.is_media() && selected_accounts.len() == selected.len())?;
                for peer in peers
                    .iter()
                    .filter(|peer| selected.contains(&peer.enrollment.device_key))
                {
                    require(
                        crate::community::authorized(auth, peer)
                            && super::voice_rooms::room_permissions(
                                auth,
                                &peer.account_id,
                                signal.expires_at.saturating_sub(60_000),
                            ),
                    )?;
                }
                Ok(())
            } else {
                require(accounts.len() == 3 && selected_accounts == accounts)
            }
        } else {
            require(accounts.len() == 2)
        }
    }
    pub(super) fn verify_call(
        &self,
        id: &str,
        signal: &CallSignal,
        sender: &str,
    ) -> Result<(), String> {
        let epoch = self.groups.get(id).ok_or(ERROR)?.epoch().as_u64();
        self.verify_call_epoch(id, signal, sender, epoch)
    }
    /// Drain only newly authenticated events; call SDP never enters message history.
    pub fn take_calls(&mut self) -> Vec<LocalCallSignal> {
        std::mem::take(&mut self.call_signals)
    }

    /// Export client-only base material. Never persist it or send it to a server.
    pub fn call_key(&self, id: &str, signal: &CallSignal) -> Result<String, String> {
        self.verify_call(id, signal, &signal.from_device)?;
        require(
            [&signal.from_device, &signal.to_device].contains(&&self.own.enrollment.device_key),
        )?;
        let context = if let Some(room) = &signal.voice_room {
            fail(serde_json::to_vec(&(
                if signal.kind.starts_with("sfu-") {
                    "hearth/v1/sfu-room/pair"
                } else {
                    "hearth/v1/voice-room/pair"
                },
                &self.server,
                id,
                room,
                &signal.group_id,
                &signal.participants,
                &signal.call_id,
                signal.epoch,
                &signal.from_device,
                &signal.to_device,
                signal.relay_only,
            )))?
        } else if let Some(group_id) = &signal.group_id {
            fail(serde_json::to_vec(&(
                "hearth/v1/group-call/pair",
                &self.server,
                id,
                group_id,
                &signal.participants,
                &signal.call_id,
                signal.epoch,
                &signal.from_device,
                &signal.to_device,
                signal.relay_only,
            )))?
        } else {
            fail(serde_json::to_vec(&(
                "hearth/v1/direct-call",
                &self.server,
                id,
                &signal.call_id,
                signal.epoch,
                &signal.from_device,
                &signal.to_device,
                signal.relay_only,
            )))?
        };
        let material = Zeroizing::new(fail(self.groups.get(id).ok_or(ERROR)?.export_secret(
            self.provider.crypto(),
            "hearth/v1/direct-call/base",
            &context,
            32,
        ))?);
        Ok(hex::encode(&*material))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn participation_controls_have_bounded_canonical_rounds_and_keys() {
        let mut peers = vec![random_id(), random_id(), random_id()];
        peers.sort();
        let id = random_id();
        let mut signal = CallSignal {
            call_id: id.clone(),
            epoch: 1,
            from_device: peers[0].clone(),
            to_device: peers[1].clone(),
            expires_at: 1_900_000_000_000,
            kind: "group-member".into(),
            description: None,
            relay_only: true,
            group_id: Some(id),
            participants: Some(peers),
            voice_room: None,
        };
        for round in ["01", "09", "10", "32"] {
            for state in ["joined", "left"] {
                signal.description = Some(format!("{round}:{state}:04{}", "ab".repeat(64)));
                assert!(validate(&signal).is_ok());
            }
        }
        for invalid in [
            "00:joined",
            "33:joined",
            "1:joined",
            "+1:joined",
            "01:JOINED",
            "01:left:extra",
        ] {
            signal.description = Some(format!("{invalid}:04{}", "ab".repeat(64)));
            assert!(validate(&signal).is_err());
        }
        for key in ["ab".repeat(65), format!("04{}", "AB".repeat(64))] {
            signal.description = Some(format!("01:joined:{key}"));
            assert!(validate(&signal).is_err());
        }
    }
    #[test]
    fn group_controls_require_a_canonical_fixed_roster_and_exact_public_keys() {
        let mut peers = vec![random_id(), random_id(), random_id()];
        peers.sort();
        let id = random_id();
        let signal = CallSignal {
            call_id: id.clone(),
            epoch: 2,
            from_device: peers[0].clone(),
            to_device: peers[1].clone(),
            expires_at: 1_900_000_000_000,
            kind: "group-invite".into(),
            description: None,
            relay_only: true,
            group_id: Some(id),
            participants: Some(peers.clone()),
            voice_room: None,
        };
        for kind in [
            "group-invite",
            "group-join",
            "group-decline",
            "group-leave",
            "group-ready",
            "group-start",
            "group-heartbeat",
        ] {
            let mut control = signal.clone();
            control.kind = kind.into();
            assert!(validate(&control).is_ok());
            control.description = Some("unexpected".into());
            assert!(validate(&control).is_err());
        }
        let mut key = signal.clone();
        key.kind = "group-key".into();
        key.description = Some(format!("04{}", "ab".repeat(64)));
        assert!(validate(&key).is_ok());
        for invalid in [
            None,
            Some("ab".repeat(65)),
            Some(format!("04{}", "AB".repeat(64))),
        ] {
            key.description = invalid;
            assert!(validate(&key).is_err());
        }
        let mut invalid = signal.clone();
        invalid.participants = None;
        assert!(validate(&invalid).is_err());
        invalid = signal.clone();
        invalid.group_id = None;
        assert!(validate(&invalid).is_err());
        invalid.participants = None;
        assert!(validate(&invalid).is_err());
        invalid = signal.clone();
        invalid.call_id = random_id();
        assert!(validate(&invalid).is_err());
        for selected in [
            vec![peers[0].clone(), peers[1].clone()],
            vec![peers[0].clone(), peers[0].clone(), peers[1].clone()],
            peers.iter().cloned().rev().collect(),
            vec![peers[0].clone(), peers[1].clone(), "A".repeat(64)],
        ] {
            invalid = signal.clone();
            invalid.participants = Some(selected);
            assert!(validate(&invalid).is_err());
        }
        invalid = signal;
        invalid.to_device = random_id();
        assert!(validate(&invalid).is_err());
    }

    #[test]
    fn group_exporter_binds_selected_accounts_devices_room_and_privacy() {
        let server = random_id();
        let id = random_id();
        let alice_identity = LocalIdentity::new();
        let alice_account = random_id();
        let mut alice = Messaging::new(&alice_identity, &alice_account, &server).unwrap();
        let mut bob = Messaging::new(&LocalIdentity::new(), &random_id(), &server).unwrap();
        let mut charlie = Messaging::new(&LocalIdentity::new(), &random_id(), &server).unwrap();
        let mut linked_identity = LocalIdentity::new();
        linked_identity.user = IdentityKey::from_bytes(&alice_identity.user.to_bytes());
        let mut linked = Messaging::new(&linked_identity, &alice_account, &server).unwrap();
        let commit = alice
            .add(
                &id,
                &[
                    bob.key_package().unwrap(),
                    charlie.key_package().unwrap(),
                    linked.key_package().unwrap(),
                ],
                true,
            )
            .unwrap();
        alice.accept(&commit.operation_id).unwrap();
        for peer in [&mut bob, &mut charlie, &mut linked] {
            peer.receive(&DeliveryEvent {
                seq: 1,
                conversation_id: id.clone(),
                data: DeliveryData::Welcome {
                    welcome: commit
                        .welcomes
                        .iter()
                        .find(|welcome| welcome.device_key == peer.own.enrollment.device_key)
                        .unwrap()
                        .clone(),
                    upload: commit.clone(),
                },
            })
            .unwrap();
        }
        let mut selected = vec![
            alice.own.enrollment.device_key.clone(),
            bob.own.enrollment.device_key.clone(),
            charlie.own.enrollment.device_key.clone(),
        ];
        selected.sort();
        let signal = CallSignal {
            call_id: random_id(),
            epoch: 1,
            from_device: bob.own.enrollment.device_key.clone(),
            to_device: charlie.own.enrollment.device_key.clone(),
            expires_at: 1_900_000_000_000,
            kind: "offer".into(),
            description: Some("HEARTH_GROUP_PRIVATE_SDP_CANARY".into()),
            relay_only: true,
            group_id: Some(random_id()),
            participants: Some(selected.clone()),
            voice_room: None,
        };
        let key = bob.call_key(&id, &signal).unwrap();
        assert_eq!(key, charlie.call_key(&id, &signal).unwrap());
        assert!(alice.call_key(&id, &signal).is_err());
        assert!(linked.call_key(&id, &signal).is_err());
        let mut other = signal.clone();
        other.group_id = Some(random_id());
        assert_ne!(key, bob.call_key(&id, &other).unwrap());
        other = signal.clone();
        other.call_id = random_id();
        assert_ne!(key, bob.call_key(&id, &other).unwrap());
        other = signal.clone();
        other.relay_only = false;
        assert_ne!(key, bob.call_key(&id, &other).unwrap());
        other = signal.clone();
        other.participants = Some({
            let mut peers = vec![
                linked.own.enrollment.device_key.clone(),
                bob.own.enrollment.device_key.clone(),
                charlie.own.enrollment.device_key.clone(),
            ];
            peers.sort();
            peers
        });
        assert_ne!(key, bob.call_key(&id, &other).unwrap());
        other = signal.clone();
        other.epoch += 1;
        assert!(bob.call_key(&id, &other).is_err());
        other = signal.clone();
        other.group_id = None;
        other.participants = None;
        assert!(bob.call_key(&id, &other).is_err());
        other = signal.clone();
        other.from_device = alice.own.enrollment.device_key.clone();
        other.to_device = bob.own.enrollment.device_key.clone();
        let mut invalid = vec![
            alice.own.enrollment.device_key.clone(),
            linked.own.enrollment.device_key.clone(),
            bob.own.enrollment.device_key.clone(),
        ];
        invalid.sort();
        other.participants = Some(invalid);
        assert!(validate(&other).is_ok());
        assert!(bob.call_key(&id, &other).is_err());
        other = signal.clone();
        let mut unknown = selected;
        unknown[0] = random_id();
        unknown.sort();
        other.participants = Some(unknown);
        assert!(bob.call_key(&id, &other).is_err());

        let upload = bob
            .send(
                &id,
                MessageContent::Call {
                    signal: signal.clone(),
                },
            )
            .unwrap();
        assert!(upload.archive.is_none());
        assert!(
            !serde_json::to_string(&upload)
                .unwrap()
                .contains("GROUP_PRIVATE_SDP_CANARY")
        );
        bob.accept(&upload.operation_id).unwrap();
        charlie
            .receive(&DeliveryEvent {
                seq: 2,
                conversation_id: id.clone(),
                data: DeliveryData::Message { upload },
            })
            .unwrap();
        let events = charlie.take_calls();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].signal.group_id, signal.group_id);
        assert!(charlie.view().unwrap().messages.is_empty());
        let sealed = charlie.seal().unwrap();
        assert!(!sealed.contains("GROUP_PRIVATE_SDP_CANARY") && !sealed.contains(&key));
        let mut control = signal.clone();
        control.from_device = alice.own.enrollment.device_key.clone();
        control.to_device = bob.own.enrollment.device_key.clone();
        control.call_id = control.group_id.clone().unwrap();
        control.kind = "group-key".into();
        control.description = Some(format!("04{}", "ab".repeat(64)));
        let broadcast = alice
            .send(&id, MessageContent::Call { signal: control })
            .unwrap();
        alice.accept(&broadcast.operation_id).unwrap();
        for peer in [&mut bob, &mut charlie, &mut linked] {
            let seq = peer.view().unwrap().last_seq + 1;
            peer.receive(&DeliveryEvent {
                seq,
                conversation_id: id.clone(),
                data: DeliveryData::Message {
                    upload: broadcast.clone(),
                },
            })
            .unwrap();
        }
        assert_eq!(bob.take_calls().len(), 1);
        assert_eq!(charlie.take_calls().len(), 1);
        assert!(linked.take_calls().is_empty());
        let mut forged = signal;
        forged.from_device = alice.own.enrollment.device_key.clone();
        assert!(
            bob.send(&id, MessageContent::Call { signal: forged })
                .is_err()
        );
    }
    #[test]
    fn key_update_controls_require_an_exact_transaction_identifier() {
        let mut signal = CallSignal {
            call_id: random_id(),
            epoch: 2,
            from_device: random_id(),
            to_device: random_id(),
            expires_at: 1_900_000_000_000,
            kind: String::new(),
            description: None,
            relay_only: true,
            group_id: None,
            participants: None,
            voice_room: None,
        };
        for kind in ["key-offer", "key-ready", "key-commit", "key-done"] {
            signal.kind = kind.into();
            for invalid in [
                None,
                Some("".into()),
                Some("a".repeat(63)),
                Some("A".repeat(64)),
                Some("a".repeat(65)),
            ] {
                signal.description = invalid;
                assert!(validate(&signal).is_err());
            }
            signal.description = Some(random_id());
            assert!(validate(&signal).is_ok());
        }
    }
    #[test]
    fn calls_bind_devices_epoch_and_context_and_stay_out_of_history_and_snapshots() {
        let server = random_id();
        let id = random_id();
        let alice_identity = LocalIdentity::new();
        let alice_account = random_id();
        let bob_identity = LocalIdentity::new();
        let bob_account = random_id();
        let mut alice = Messaging::new(&alice_identity, &alice_account, &server).unwrap();
        let mut bob = Messaging::new(&bob_identity, &bob_account, &server).unwrap();
        let package = bob.key_package().unwrap();
        let commit = alice.add(&id, &[package], true).unwrap();
        alice.accept(&commit.operation_id).unwrap();
        bob.receive(&DeliveryEvent {
            seq: 1,
            conversation_id: id.clone(),
            data: DeliveryData::Welcome {
                welcome: commit.welcomes[0].clone(),
                upload: commit,
            },
        })
        .unwrap();
        let signal = CallSignal {
            call_id: random_id(),
            epoch: 1,
            from_device: alice.own.enrollment.device_key.clone(),
            to_device: bob.own.enrollment.device_key.clone(),
            expires_at: 1_900_000_000_000,
            kind: "offer".into(),
            description: Some("HEARTH_PRIVATE_SDP_CANARY".into()),
            relay_only: false,
            group_id: None,
            participants: None,
            voice_room: None,
        };
        let key = alice.call_key(&id, &signal).unwrap();
        assert_eq!(key, bob.call_key(&id, &signal).unwrap());
        let mut other = signal.clone();
        other.call_id = random_id();
        assert_ne!(key, alice.call_key(&id, &other).unwrap());
        other = signal.clone();
        other.relay_only = true;
        assert_ne!(key, alice.call_key(&id, &other).unwrap());
        other = signal.clone();
        other.epoch += 1;
        assert!(alice.call_key(&id, &other).is_err());
        other = signal.clone();
        other.to_device = random_id();
        assert!(alice.call_key(&id, &other).is_err());
        other = signal.clone();
        other.from_device = bob.own.enrollment.device_key.clone();
        other.to_device = alice.own.enrollment.device_key.clone();
        assert!(
            alice
                .send(&id, MessageContent::Call { signal: other })
                .is_err()
        );
        let upload = alice
            .send(
                &id,
                MessageContent::Call {
                    signal: signal.clone(),
                },
            )
            .unwrap();
        assert!(upload.action == MessageAction::Control && upload.archive.is_none());
        assert!(
            !serde_json::to_string(&upload)
                .unwrap()
                .contains("PRIVATE_SDP_CANARY")
        );
        alice.accept(&upload.operation_id).unwrap();
        bob.receive(&DeliveryEvent {
            seq: 2,
            conversation_id: id.clone(),
            data: DeliveryData::Message { upload },
        })
        .unwrap();
        let sealed = bob.seal().unwrap();
        assert!(!sealed.contains("PRIVATE_SDP_CANARY") && !sealed.contains(&key));
        assert_eq!(bob.take_calls().len(), 1);
        assert!(bob.take_calls().is_empty());
        assert!(bob.view().unwrap().messages.is_empty());
        let mut reopened = Messaging::open(&bob_identity, &bob_account, &server, &sealed).unwrap();
        assert!(reopened.take_calls().is_empty());
        let mut linked_identity = LocalIdentity::new();
        linked_identity.user = IdentityKey::from_bytes(&bob_identity.user.to_bytes());
        let mut linked = Messaging::new(&linked_identity, &bob_account, &server).unwrap();
        let added = alice
            .add(&id, &[linked.key_package().unwrap()], false)
            .unwrap();
        alice.accept(&added.operation_id).unwrap();
        bob.receive(&DeliveryEvent {
            seq: 3,
            conversation_id: id.clone(),
            data: DeliveryData::Commit { upload: added },
        })
        .unwrap();
        assert!(alice.call_key(&id, &signal).is_err());
        other = signal;
        other.epoch = 2;
        assert_ne!(key, alice.call_key(&id, &other).unwrap());
        assert_eq!(
            alice.call_key(&id, &other).unwrap(),
            bob.call_key(&id, &other).unwrap()
        );
        let mut rotation = other.clone();
        rotation.call_id = random_id();
        assert_ne!(
            alice.call_key(&id, &other).unwrap(),
            alice.call_key(&id, &rotation).unwrap()
        );
        assert_eq!(
            alice.call_key(&id, &rotation).unwrap(),
            bob.call_key(&id, &rotation).unwrap()
        );
        let mut charlie = Messaging::new(&LocalIdentity::new(), &random_id(), &server).unwrap();
        let group_id = random_id();
        let group = alice
            .add(
                &group_id,
                &[bob.key_package().unwrap(), charlie.key_package().unwrap()],
                true,
            )
            .unwrap();
        alice.accept(&group.operation_id).unwrap();
        other.epoch = 1;
        assert!(alice.call_key(&group_id, &other).is_err());
    }
}
