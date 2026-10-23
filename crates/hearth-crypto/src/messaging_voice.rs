use super::*;
use hearth_proto::voice::{VoicePresence, VoiceRoom};

pub(super) fn room_permissions(
    auth: &hearth_proto::community::ChannelAuthorization,
    account: &str,
    now: u64,
) -> bool {
    use hearth_proto::governance::{CONNECT, LISTEN, room_media_permissions};
    let bits = crate::community::permissions(auth, account, now);
    room_media_permissions(
        auth.governance.as_ref(),
        bits,
        auth.policy.kind == ChannelKind::Stage,
        account == auth.authority.owner.account_id,
    ) & (CONNECT | LISTEN)
        == CONNECT | LISTEN
}

impl Messaging {
    fn voice_access(&self, id: &str, now: u64) -> Result<(), String> {
        let auth = self.state.channels.get(id).ok_or(ERROR)?;
        require(
            auth.policy.kind.is_media()
                && crate::community::authorized(auth, &self.own)
                && room_permissions(auth, &self.own.account_id, now),
        )
    }
    pub fn sign_voice_presence(&self, mut value: VoicePresence) -> Result<VoicePresence, String> {
        self.voice_access(&value.channel_id, value.issued_at)?;
        require(
            value.device_key == self.own.enrollment.device_key
                && self
                    .groups
                    .get(&value.channel_id)
                    .ok_or(ERROR)?
                    .epoch()
                    .as_u64()
                    == value.epoch,
        )?;
        crate::voice::validate(&value)?;
        value.signature = hex::encode(
            self.device
                .sign_scoped(&crate::voice::statement(&self.server, &value)?),
        );
        Ok(value)
    }
    pub fn verify_voice_room(&self, value: &VoiceRoom, now: u64) -> Result<(), String> {
        self.voice_access(&value.channel_id, now)?;
        require(
            valid_id(&value.room_id)
                && value.sfu != Some(false)
                && value.capacity == if value.sfu == Some(true) { 25 } else { 4 }
                && value.revision > 0
                && value.revision < 9_007_199_254_740_991
                && value.participants.len() <= value.capacity as usize
                && self
                    .groups
                    .get(&value.channel_id)
                    .ok_or(ERROR)?
                    .epoch()
                    .as_u64()
                    == value.epoch
                && value
                    .participants
                    .windows(2)
                    .all(|pair| pair[0].device_key < pair[1].device_key),
        )?;
        let auth = self.state.channels.get(&value.channel_id).ok_or(ERROR)?;
        let members = self
            .groups
            .get(&value.channel_id)
            .ok_or(ERROR)?
            .members()
            .map(|leaf| self.verified_member(&leaf.credential, &leaf.signature_key))
            .collect::<Result<Vec<_>, _>>()?;
        let mut accounts = std::collections::BTreeSet::new();
        for presence in &value.participants {
            crate::voice::verify(&self.server, presence)?;
            let peer = members
                .iter()
                .find(|peer| peer.enrollment.device_key == presence.device_key)
                .ok_or(ERROR)?;
            require(
                presence.active
                    && presence.channel_id == value.channel_id
                    && presence.room_id == value.room_id
                    && presence.epoch == value.epoch
                    && presence.relay_only == value.relay_only
                    && presence.sfu == value.sfu
                    && presence.issued_at <= now.saturating_add(5_000)
                    && presence.expires_at > now
                    && accounts.insert(&peer.account_id)
                    && crate::community::authorized(auth, peer)
                    && room_permissions(auth, &peer.account_id, now),
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_room_occupancy_binds_approved_mls_devices_and_room_exporter_context() {
        let server = random_id();
        let community = random_id();
        let channel = random_id();
        let room_id = random_id();
        let mut alice = Messaging::new(&LocalIdentity::new(), &random_id(), &server).unwrap();
        let mut bob = Messaging::new(&LocalIdentity::new(), &random_id(), &server).unwrap();
        let mut charlie = Messaging::new(&LocalIdentity::new(), &random_id(), &server).unwrap();
        let root = alice.sign_authority(&community).unwrap();
        let policy = alice
            .sign_policy(&root, &channel, ChannelKind::Voice, HistoryPolicy::None, 1)
            .unwrap();
        let package = bob.key_package().unwrap();
        let charlie_package = charlie.key_package().unwrap();
        let charlie_grant = alice
            .sign_admission(
                &root,
                &charlie.own.account_id,
                &charlie_package.member.enrollment.identity_key,
                BTreeMap::new(),
            )
            .unwrap();
        let grant = alice
            .sign_admission(
                &root,
                &bob.own.account_id,
                &package.member.enrollment.identity_key,
                BTreeMap::new(),
            )
            .unwrap();
        let auth = ChannelAuthorization {
            authority: root,
            policy,
            admissions: vec![grant, charlie_grant],
            governance: None,
            departures: vec![],
        };
        alice.authorize_channel(&channel, &auth).unwrap();
        let commit = alice
            .add_channel(&channel, &[package, charlie_package], true)
            .unwrap();
        alice.accept(&commit.operation_id).unwrap();
        for peer in [&mut bob, &mut charlie] {
            peer.receive(&DeliveryEvent {
                seq: 1,
                conversation_id: channel.clone(),
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
        assert_eq!(
            alice.view().unwrap().groups[0].channel_id.as_deref(),
            Some(channel.as_str())
        );
        let presence = |device: String| VoicePresence {
            channel_id: channel.clone(),
            room_id: room_id.clone(),
            epoch: 1,
            device_key: device,
            incarnation: random_id(),
            public_key: format!("04{}", "ab".repeat(64)),
            relay_only: true,
            sfu: None,
            active: true,
            issued_at: 1_000,
            expires_at: 31_000,
            signature: String::new(),
        };
        let a = alice
            .sign_voice_presence(presence(alice.own.enrollment.device_key.clone()))
            .unwrap();
        let b = bob
            .sign_voice_presence(presence(bob.own.enrollment.device_key.clone()))
            .unwrap();
        let c = charlie
            .sign_voice_presence(presence(charlie.own.enrollment.device_key.clone()))
            .unwrap();
        let mut participants = vec![a, b, c];
        participants.sort_by(|a, b| a.device_key.cmp(&b.device_key));
        let room = VoiceRoom {
            channel_id: channel.clone(),
            room_id: room_id.clone(),
            epoch: 1,
            revision: 1,
            relay_only: true,
            capacity: 4,
            sfu: None,
            participants,
        };
        alice.verify_voice_room(&room, 2_000).unwrap();
        bob.verify_voice_room(&room, 2_000).unwrap();
        assert!(alice.verify_voice_room(&room, 31_000).is_err());
        let mut tampered = room.clone();
        tampered.participants[0].public_key = format!("04{}", "cd".repeat(64));
        assert!(bob.verify_voice_room(&tampered, 2_000).is_err());
        let mut spoof = presence(alice.own.enrollment.device_key.clone());
        assert!(bob.sign_voice_presence(spoof.clone()).is_err());
        spoof.device_key = bob.own.enrollment.device_key.clone();
        spoof.epoch = 2;
        assert!(bob.sign_voice_presence(spoof).is_err());
        let selected = room
            .participants
            .iter()
            .map(|peer| peer.device_key.clone())
            .collect::<Vec<_>>();
        let signal = CallSignal {
            call_id: random_id(),
            epoch: 1,
            from_device: alice.own.enrollment.device_key.clone(),
            to_device: bob.own.enrollment.device_key.clone(),
            expires_at: 61_000,
            kind: "offer".into(),
            description: Some("private room SDP".into()),
            relay_only: true,
            group_id: Some(random_id()),
            participants: Some(selected),
            voice_room: Some(room_id),
        };
        let key = alice.call_key(&channel, &signal).unwrap();
        assert_eq!(key, bob.call_key(&channel, &signal).unwrap());
        let mut changed = signal.clone();
        changed.voice_room = Some(random_id());
        assert_ne!(key, alice.call_key(&channel, &changed).unwrap());
        changed = signal.clone();
        changed.voice_room = None;
        assert!(alice.call_key(&channel, &changed).is_err());
        let mut heartbeat = signal.clone();
        heartbeat.kind = "room-heartbeat".into();
        heartbeat.call_id = heartbeat.group_id.clone().unwrap();
        heartbeat.description = None;
        super::super::calls::validate(&heartbeat).unwrap();
        for description in [
            "00000000:00",
            "1:11",
            "00000001:20",
            "00000001:1111",
            "é000001:00",
        ] {
            heartbeat.description = Some(description.into());
            assert!(super::super::calls::validate(&heartbeat).is_err());
        }
        heartbeat.description = Some("00000001:11".into());
        super::super::calls::validate(&heartbeat).unwrap();
        heartbeat.description = Some("00000001:111".into());
        super::super::calls::validate(&heartbeat).unwrap();
        let upload = alice
            .send(
                &channel,
                MessageContent::Call {
                    signal: heartbeat.clone(),
                },
            )
            .unwrap();
        assert!(upload.archive.is_none());
        alice.accept(&upload.operation_id).unwrap();
        for peer in [&mut bob, &mut charlie] {
            peer.receive(&DeliveryEvent {
                seq: 2,
                conversation_id: channel.clone(),
                data: DeliveryData::Message {
                    upload: upload.clone(),
                },
            })
            .unwrap();
            assert_eq!(peer.take_calls().len(), 1);
            assert!(peer.view().unwrap().messages.is_empty());
        }
        // The broadcast names Bob but also reaches the selected Charlie device.
        assert_eq!(heartbeat.to_device, bob.own.enrollment.device_key);
        changed = signal;
        changed.participants.as_mut().unwrap().push(random_id());
        changed.participants.as_mut().unwrap().sort();
        assert!(alice.call_key(&channel, &changed).is_err());
    }
    #[test]
    #[ignore = "25-device MLS admission milestone; run explicitly (about five minutes)"]
    fn twenty_five_signed_sfu_participants_keep_keys_out_of_server_admission() {
        let server = random_id();
        let community = random_id();
        let channel = random_id();
        let mut owner = Messaging::new(&LocalIdentity::new(), &random_id(), &server).unwrap();
        let authority = owner.sign_authority(&community).unwrap();
        let policy = owner
            .sign_policy(
                &authority,
                &channel,
                ChannelKind::Voice,
                HistoryPolicy::None,
                1,
            )
            .unwrap();
        let mut peers = (0..24)
            .map(|_| Messaging::new(&LocalIdentity::new(), &random_id(), &server).unwrap())
            .collect::<Vec<_>>();
        let mut packages = vec![];
        let mut admissions = vec![];
        for peer in &mut peers {
            let package = peer.key_package().unwrap();
            admissions.push(
                owner
                    .sign_admission(
                        &authority,
                        &peer.own.account_id,
                        &package.member.enrollment.identity_key,
                        BTreeMap::new(),
                    )
                    .unwrap(),
            );
            packages.push(package);
        }
        let authorization = ChannelAuthorization {
            authority,
            policy,
            admissions,
            governance: None,
            departures: vec![],
        };
        owner.authorize_channel(&channel, &authorization).unwrap();
        let commit = owner.add_channel(&channel, &packages, true).unwrap();
        owner.accept(&commit.operation_id).unwrap();
        for peer in &mut peers {
            peer.receive(&DeliveryEvent {
                seq: 1,
                conversation_id: channel.clone(),
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
        let room_id = random_id();
        let mut participants = vec![];
        for peer in std::iter::once(&owner).chain(peers.iter()) {
            participants.push(
                peer.sign_voice_presence(VoicePresence {
                    channel_id: channel.clone(),
                    room_id: room_id.clone(),
                    epoch: 1,
                    device_key: peer.own.enrollment.device_key.clone(),
                    incarnation: random_id(),
                    public_key: format!("04{}", "ab".repeat(64)),
                    relay_only: false,
                    sfu: Some(true),
                    active: true,
                    issued_at: 1000,
                    expires_at: 31000,
                    signature: String::new(),
                })
                .unwrap(),
            );
        }
        participants.sort_by(|a, b| a.device_key.cmp(&b.device_key));
        let room = VoiceRoom {
            channel_id: channel.clone(),
            room_id: room_id.clone(),
            epoch: 1,
            revision: 3,
            relay_only: false,
            sfu: Some(true),
            capacity: 25,
            participants,
        };
        owner.verify_voice_room(&room, 2000).unwrap();
        for peer in &peers {
            peer.verify_voice_room(&room, 2000).unwrap();
        }
        let mut wrong = room.clone();
        wrong.sfu = None;
        assert!(owner.verify_voice_room(&wrong, 2000).is_err());
        let sender = owner.own.enrollment.device_key.clone();
        let recipient = peers[0].own.enrollment.device_key.clone();
        let context = random_id();
        let wrapped = room
            .participants
            .iter()
            .filter(|peer| peer.device_key != sender)
            .map(|peer| hearth_proto::voice::WrappedMediaKey {
                recipient: peer.device_key.clone(),
                nonce: "00".repeat(12),
                ciphertext: "00".repeat(48),
            })
            .collect::<Vec<_>>();
        let signal = CallSignal {
            call_id: context.clone(),
            group_id: Some(context),
            voice_room: Some(room_id),
            epoch: 1,
            participants: Some(
                room.participants
                    .iter()
                    .map(|peer| peer.device_key.clone())
                    .collect(),
            ),
            from_device: sender,
            to_device: recipient,
            kind: "sfu-key".into(),
            description: Some(serde_json::to_string(&wrapped).unwrap()),
            relay_only: false,
            expires_at: 61000,
        };
        let key = owner.call_key(&channel, &signal).unwrap();
        assert_eq!(key, peers[0].call_key(&channel, &signal).unwrap());
        assert!(peers[1].call_key(&channel, &signal).is_err());
        let upload = owner
            .send(
                &channel,
                MessageContent::Call {
                    signal: signal.clone(),
                },
            )
            .unwrap();
        assert!(upload.archive.is_none());
        owner.accept(&upload.operation_id).unwrap();
        for peer in &mut peers {
            peer.receive(&DeliveryEvent {
                seq: 2,
                conversation_id: channel.clone(),
                data: DeliveryData::Message {
                    upload: upload.clone(),
                },
            })
            .unwrap();
            assert_eq!(peer.take_calls().len(), 1);
            assert!(peer.view().unwrap().messages.is_empty());
        }
        let mut overflow = signal;
        overflow.participants.as_mut().unwrap().push(random_id());
        overflow.participants.as_mut().unwrap().sort();
        assert!(owner.call_key(&channel, &overflow).is_err());
    }
}
