//! Bounded public voice occupancy. Media and SDP never enter this module.
use crate::{
    SharedState,
    community::{ChannelAccess, channel_access},
    delivery::approved,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use hearth_proto::{
    community::ChannelKind,
    messaging::GroupMember,
    voice::{VoicePresence, VoiceRoom},
};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Row};
type Result<T> = std::result::Result<T, StatusCode>;
fn unavailable(_: sqlx::Error) -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

async fn permitted(
    tx: &mut PgConnection,
    channel: &str,
    account: &str,
) -> Result<(u32, String, ChannelAccess)> {
    let access = channel_access(tx, channel, account)
        .await?
        .ok_or(StatusCode::NOT_FOUND)?;
    let bits = crate::governance::bits(
        tx,
        &access.community_id,
        &access.owner_id,
        account,
        Some(channel),
        access.governance.as_ref(),
    )
    .await?;
    let media = hearth_proto::governance::room_media_permissions(
        access.governance.as_ref(),
        bits,
        access.kind == ChannelKind::Stage,
        account == access.owner_id,
    );
    let required = hearth_proto::governance::CONNECT | hearth_proto::governance::LISTEN;
    if !access.kind.is_media() || media & required != required {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok((
        media,
        access
            .governance
            .as_ref()
            .map(|policy| policy.signature.clone())
            .unwrap_or_default(),
        access,
    ))
}
async fn authenticated(state: &SharedState, headers: &HeaderMap, device: &str) -> Result<String> {
    let account = crate::device::account_id(state, headers).await?;
    state.auth.limit_delivery(&account)?;
    approved(state, &account, device).await?;
    Ok(account)
}
// Community locks precede conversation and room locks, matching MLS/governance.
async fn room(
    tx: &mut PgConnection,
    channel: &str,
    account: &str,
    device: &str,
    sfu: bool,
) -> Result<VoiceRoom> {
    let (_, policy_signature, access) = permitted(tx, channel, account).await?;
    let row = sqlx::query(
        "SELECT epoch,members FROM conversations WHERE id=$1 AND channel_id=$1 FOR SHARE",
    )
    .bind(channel)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?
    .ok_or(StatusCode::CONFLICT)?;
    let members: Vec<GroupMember> =
        serde_json::from_value(row.get("members")).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    if !members
        .iter()
        .any(|peer| peer.account_id == account && peer.enrollment.device_key == device)
    {
        return Err(StatusCode::FORBIDDEN);
    }
    let devices = members
        .iter()
        .map(|peer| peer.enrollment.device_key.clone())
        .collect::<Vec<_>>();
    let compatible: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM group_media_capabilities WHERE device_key=ANY($1) AND format=5",
    )
    .bind(&devices)
    .fetch_one(&mut *tx)
    .await
    .map_err(unavailable)?;
    if compatible != devices.len() as i64 {
        return Err(StatusCode::CONFLICT);
    }
    let epoch: i64 = row.get("epoch");
    let id = hearth_crypto::messaging::random_id();
    sqlx::query(
        "INSERT INTO voice_rooms(channel_id,room_id,epoch) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    )
    .bind(channel)
    .bind(&id)
    .bind(epoch)
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?;
    let state = sqlx::query(
        "SELECT room_id,epoch,revision,relay_only,sfu,policy_signature,roster_digest FROM voice_rooms WHERE channel_id=$1 FOR UPDATE",
    )
    .bind(channel)
    .fetch_one(&mut *tx)
    .await
    .map_err(unavailable)?;
    let changed = state.get::<i64, _>("epoch") != epoch || state.get::<bool, _>("sfu") != sfu;
    if changed {
        sqlx::query("DELETE FROM voice_presence WHERE channel_id=$1")
            .bind(channel)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        sqlx::query("UPDATE voice_rooms SET room_id=$2,epoch=$3,revision=1,relay_only=FALSE,sfu=$4 WHERE channel_id=$1")
            .bind(channel).bind(&id).bind(epoch).bind(sfu).execute(&mut *tx).await.map_err(unavailable)?;
    }
    let mut result = VoiceRoom {
        channel_id: channel.into(),
        room_id: if changed { id } else { state.get("room_id") },
        epoch: epoch as u64,
        revision: if changed {
            1
        } else {
            state.get::<i64, _>("revision") as u64
        },
        relay_only: !changed && state.get("relay_only"),
        capacity: if sfu { 25 } else { 4 },
        sfu: sfu.then_some(true),
        participants: vec![],
    };
    if changed || state.get::<String, _>("policy_signature") != policy_signature {
        sqlx::query("UPDATE voice_rooms SET policy_signature=$2 WHERE channel_id=$1")
            .bind(channel)
            .bind(&policy_signature)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
    }
    sqlx::query("DELETE FROM voice_presence WHERE channel_id=$1 AND NOT (presence->>'active')::boolean AND (presence->>'expires_at')::bigint<$2")
        .bind(channel).bind(now().saturating_sub(120_000) as i64).execute(&mut *tx).await.map_err(unavailable)?;
    let entries = sqlx::query("SELECT device_key,account_id,presence FROM voice_presence WHERE channel_id=$1 ORDER BY device_key")
        .bind(channel).fetch_all(&mut *tx).await.map_err(unavailable)?;
    // The community SHARE lock already fixes the current policy. Read current
    // membership, account deletion, invite time and rules acceptance together,
    // instead of reloading that same policy six times per occupied device while
    // holding the exclusive room lock. Every returned peer still needs READ,
    // CONNECT and LISTEN under the current signed policy.
    let accounts = entries
        .iter()
        .map(|entry| entry.get::<String, _>("account_id"))
        .collect::<Vec<_>>();
    let digest = access
        .governance
        .as_ref()
        .map(crate::governance::rules_digest)
        .unwrap_or_default();
    let rows=sqlx::query("SELECT m.account_id, CASE WHEN m.admission IS NOT NULL THEN m.admission->'invitation' ELSE m.invitation END AS invitation, EXISTS(SELECT 1 FROM community_rules_acceptance r WHERE r.community_id=m.community_id AND r.account_id=m.account_id AND r.digest=$3) AS rules_accepted FROM community_members m JOIN accounts a ON a.id=m.account_id WHERE m.community_id=$1 AND m.account_id=ANY($2) AND NOT a.deleted")
        .bind(&access.community_id).bind(&accounts).bind(&digest).fetch_all(&mut *tx).await.map_err(unavailable)?;
    let allowed = rows
        .into_iter()
        .filter_map(|row| {
            let account: String = row.get("account_id");
            let invitation: Option<serde_json::Value> = row.get("invitation");
            let issued = invitation
                .as_ref()
                .and_then(|value| value.get("issued_at"))
                .and_then(serde_json::Value::as_u64);
            peer_permitted(
                &access,
                channel,
                &account,
                issued,
                row.get("rules_accepted"),
                now(),
            )
            .then_some(account)
        })
        .collect::<std::collections::HashSet<_>>();
    let mut removed = false;
    for entry in entries {
        let mut presence: VoicePresence = serde_json::from_value(entry.get("presence"))
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        if presence.active
            && (presence.expires_at <= now()
                || !devices.contains(&presence.device_key)
                || !allowed.contains(entry.get::<&str, _>("account_id")))
        {
            // Do not forge a signed departure. Delete the expired/revoked public
            // statement; its original expiry still bounds any server replay.
            sqlx::query("DELETE FROM voice_presence WHERE channel_id=$1 AND device_key=$2")
                .bind(channel)
                .bind(&presence.device_key)
                .execute(&mut *tx)
                .await
                .map_err(unavailable)?;
            removed = true;
            presence.active = false;
        }
        if presence.active {
            result.participants.push(presence);
        }
    }
    if removed
        || state.get::<String, _>("roster_digest") != roster_digest(&result)
        || !changed && state.get::<String, _>("policy_signature") != policy_signature
    {
        advance(tx, &mut result).await?;
    }
    Ok(result)
}
fn peer_permitted(
    access: &ChannelAccess,
    channel: &str,
    account: &str,
    issued: Option<u64>,
    rules_accepted: bool,
    now: u64,
) -> bool {
    use hearth_proto::governance::{
        CONNECT, LISTEN, READ, permissions_with_invite, room_media_permissions,
    };
    let policy = access.governance.as_ref();
    let bits = permissions_with_invite(
        policy,
        &access.owner_id,
        account,
        Some(channel),
        now,
        issued,
    );
    let rules = policy
        .is_none_or(|policy| !policy.screening || account == access.owner_id || rules_accepted);
    rules
        && access.kind.is_media()
        && bits & READ != 0
        && room_media_permissions(
            policy,
            bits,
            access.kind == ChannelKind::Stage,
            account == access.owner_id,
        ) & (CONNECT | LISTEN)
            == CONNECT | LISTEN
}
fn roster_digest(room: &VoiceRoom) -> String {
    let mut digest = Sha256::new();
    for peer in &room.participants {
        for value in [&peer.device_key, &peer.incarnation, &peer.public_key] {
            digest.update((value.len() as u64).to_be_bytes());
            digest.update(value.as_bytes());
        }
    }
    hex::encode(digest.finalize())
}
async fn advance(tx: &mut PgConnection, room: &mut VoiceRoom) -> Result<()> {
    if room.revision >= 9_007_199_254_740_990 {
        return Err(StatusCode::CONFLICT);
    }
    room.revision += 1;
    sqlx::query(
        "UPDATE voice_rooms SET revision=$2,relay_only=$3,roster_digest=$4 WHERE channel_id=$1",
    )
    .bind(&room.channel_id)
    .bind(room.revision as i64)
    .bind(room.relay_only)
    .bind(roster_digest(room))
    .execute(tx)
    .await
    .map_err(unavailable)?;
    Ok(())
}
pub(crate) async fn get(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path((channel, device)): Path<(String, String)>,
) -> Result<Json<VoiceRoom>> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers, &device).await?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let result = room(
        &mut tx,
        &channel,
        &account,
        &device,
        state.config.media.sfu.is_some(),
    )
    .await?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(result))
}
pub(crate) async fn update(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path((channel, device)): Path<(String, String)>,
    Json(value): Json<VoicePresence>,
) -> Result<Json<VoiceRoom>> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers, &device).await?;
    hearth_crypto::voice::verify(&state.server_key.public().to_hex(), &value)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    if value.channel_id != channel
        || value.device_key != device
        || value.expires_at <= now()
        || value.issued_at > now() + 5_000
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let mut current = room(
        &mut tx,
        &channel,
        &account,
        &device,
        state.config.media.sfu.is_some(),
    )
    .await?;
    if value.room_id != current.room_id || value.epoch != current.epoch || value.sfu != current.sfu
    {
        return Err(StatusCode::CONFLICT);
    }
    let previous: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT presence FROM voice_presence WHERE channel_id=$1 AND device_key=$2",
    )
    .bind(&channel)
    .bind(&device)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?;
    if let Some(previous) = previous {
        let previous: VoicePresence =
            serde_json::from_value(previous).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        if value.issued_at <= previous.issued_at
            || (value.incarnation == previous.incarnation
                && (!previous.active && value.active
                    || value.public_key != previous.public_key
                    || value.relay_only != previous.relay_only))
        {
            return Err(StatusCode::CONFLICT);
        }
    }
    if value.active {
        if current
            .participants
            .iter()
            .any(|peer| peer.device_key != device && peer.relay_only != value.relay_only)
        {
            return Err(StatusCode::CONFLICT);
        }
        let others = current
            .participants
            .iter()
            .filter(|peer| peer.device_key != device)
            .collect::<Vec<_>>();
        if others.len() >= current.capacity as usize {
            return Err(StatusCode::CONFLICT);
        }
        for other in others {
            let owner: String =
                sqlx::query_scalar("SELECT account_id FROM account_devices WHERE device_key=$1")
                    .bind(&other.device_key)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(unavailable)?;
            if owner == account {
                return Err(StatusCode::CONFLICT);
            }
        }
    }
    let old = current
        .participants
        .iter()
        .find(|peer| peer.device_key == device);
    let changed = old.map(|peer| (&peer.incarnation, &peer.public_key))
        != value
            .active
            .then_some((&value.incarnation, &value.public_key));
    current
        .participants
        .retain(|peer| peer.device_key != device);
    if value.active {
        current.relay_only = value.relay_only;
        current.participants.push(value.clone());
        current
            .participants
            .sort_by(|a, b| a.device_key.cmp(&b.device_key));
    }
    sqlx::query("INSERT INTO voice_presence(channel_id,device_key,account_id,presence) VALUES($1,$2,$3,$4) ON CONFLICT(channel_id,device_key) DO UPDATE SET presence=EXCLUDED.presence")
        .bind(&channel).bind(&device).bind(&account).bind(serde_json::to_value(&value).map_err(|_|StatusCode::BAD_REQUEST)?)
        .execute(&mut *tx).await.map_err(unavailable)?;
    if changed {
        advance(&mut tx, &mut current).await?;
    }
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(current))
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SfuRevision {
    revision: u64,
}
pub(crate) async fn sfu_access(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path((channel, device)): Path<(String, String)>,
    Query(query): Query<SfuRevision>,
) -> Result<Json<hearth_proto::voice::SfuAccess>> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers, &device).await?;
    let config = state
        .config
        .media
        .sfu
        .as_ref()
        .ok_or(StatusCode::NOT_IMPLEMENTED)?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let current = room(&mut tx, &channel, &account, &device, true).await?;
    if query.revision != current.revision {
        return Err(StatusCode::CONFLICT);
    }
    let (permissions, _, _) = permitted(&mut tx, &channel, &account).await?;
    let result = config
        .access(&current, &device, now(), permissions)
        .map_err(|_| StatusCode::FORBIDDEN)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    use hearth_proto::governance::*;
    use serde_json::json;

    #[sqlx::test(migrations = "./migrations")]
    #[ignore = "requires isolated PostgreSQL"]
    async fn batched_presence_prunes_deleted_departed_unscreened_and_denied_peers(
        db: sqlx::PgPool,
    ) {
        let ids = (0..4)
            .map(|_| hearth_crypto::messaging::random_id())
            .collect::<Vec<_>>();
        let community = hearth_crypto::messaging::random_id();
        let channel = hearth_crypto::messaging::random_id();
        let mut members = Vec::new();
        for (index, id) in ids.iter().enumerate() {
            let identity = hearth_crypto::vault::LocalIdentity::new();
            let enrollment: hearth_proto::device::DeviceEnrollment =
                serde_json::from_value(json!(identity.enrollment(id, &"0".repeat(64)).unwrap()))
                    .unwrap();
            sqlx::query("INSERT INTO accounts(id,username,opaque_profile,password_file) VALUES($1,$2,'test',$3)").bind(id).bind(format!("voice_{index}")).bind(vec![0u8]).execute(&db).await.unwrap();
            sqlx::query("INSERT INTO account_devices(account_id,device_key,certificate,account_signature,device_signature) VALUES($1,$2,$3,$4,$5)").bind(id).bind(&enrollment.device_key).bind(&enrollment.certificate).bind(&enrollment.account_signature).bind(&enrollment.device_signature).execute(&db).await.unwrap();
            sqlx::query("INSERT INTO group_media_capabilities(device_key,format) VALUES($1,5)")
                .bind(&enrollment.device_key)
                .execute(&db)
                .await
                .unwrap();
            members.push(GroupMember {
                account_id: id.clone(),
                enrollment,
            });
        }
        let mut policy:Governance=serde_json::from_value(json!({"media_version":1,"community_id":community,"revision":1,"everyone":READ|CONNECT|LISTEN,"roles":[],"assignments":[],"overrides":[],"sanctions":[],"limits":[],"rules":"Fixture rules","screening":false,"owner":members[0],"signature":""})).unwrap();
        sqlx::query(
            "INSERT INTO communities(id,name,owner_id,governance) VALUES($1,'Voice fixture',$2,$3)",
        )
        .bind(&community)
        .bind(&ids[0])
        .bind(json!(policy))
        .execute(&db)
        .await
        .unwrap();
        for id in &ids {
            sqlx::query("INSERT INTO community_members(community_id,account_id) VALUES($1,$2)")
                .bind(&community)
                .bind(id)
                .execute(&db)
                .await
                .unwrap();
        }
        sqlx::query("INSERT INTO community_channels(id,community_id,name,kind) VALUES($1,$2,'room','voice')").bind(&channel).bind(&community).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO conversations(id,channel_id,epoch,members) VALUES($1,$1,1,$2)")
            .bind(&channel)
            .bind(json!(members))
            .execute(&db)
            .await
            .unwrap();
        let device = &members[0].enrollment.device_key;
        let mut tx = db.begin().await.unwrap();
        let initial = room(&mut tx, &channel, &ids[0], device, true)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let mut presences = Vec::new();
        for member in &members {
            let presence = VoicePresence {
                channel_id: channel.clone(),
                room_id: initial.room_id.clone(),
                epoch: 1,
                device_key: member.enrollment.device_key.clone(),
                incarnation: hearth_crypto::messaging::random_id(),
                public_key: format!("04{}", "1".repeat(128)),
                relay_only: false,
                sfu: Some(true),
                active: true,
                issued_at: now(),
                expires_at: now() + 30_000,
                signature: "0".repeat(128),
            };
            presences.push(presence);
        }
        async fn insert(db: &sqlx::PgPool, channel: &str, account: &str, presence: &VoicePresence) {
            sqlx::query("INSERT INTO voice_presence(channel_id,device_key,account_id,presence) VALUES($1,$2,$3,$4) ON CONFLICT(channel_id,device_key) DO UPDATE SET presence=EXCLUDED.presence").bind(channel).bind(&presence.device_key).bind(account).bind(json!(presence)).execute(db).await.unwrap();
        }
        for (index, presence) in presences.iter().enumerate() {
            insert(&db, &channel, &ids[index], presence).await;
        }
        async fn occupancy(db: &sqlx::PgPool, channel: &str, account: &str, device: &str) -> usize {
            let mut tx = db.begin().await.unwrap();
            let value = room(&mut tx, channel, account, device, true).await.unwrap();
            tx.commit().await.unwrap();
            value.participants.len()
        }
        assert_eq!(occupancy(&db, &channel, &ids[0], device).await, 4);
        // This private SQL-selection regression does not exercise the public
        // account-departure signature API (covered by account acceptance).
        sqlx::query("UPDATE accounts SET deleted=TRUE,departure='{}'::jsonb WHERE id=$1")
            .bind(&ids[1])
            .execute(&db)
            .await
            .unwrap();
        assert_eq!(occupancy(&db, &channel, &ids[0], device).await, 3);
        sqlx::query("DELETE FROM community_members WHERE community_id=$1 AND account_id=$2")
            .bind(&community)
            .bind(&ids[2])
            .execute(&db)
            .await
            .unwrap();
        assert_eq!(occupancy(&db, &channel, &ids[0], device).await, 2);
        policy.screening = true;
        sqlx::query("UPDATE communities SET governance=$2 WHERE id=$1")
            .bind(&community)
            .bind(json!(policy))
            .execute(&db)
            .await
            .unwrap();
        assert_eq!(occupancy(&db, &channel, &ids[0], device).await, 1);
        sqlx::query("INSERT INTO community_rules_acceptance(community_id,account_id,digest) VALUES($1,$2,$3)").bind(&community).bind(&ids[3]).bind(crate::governance::rules_digest(&policy)).execute(&db).await.unwrap();
        insert(&db, &channel, &ids[3], &presences[3]).await;
        assert_eq!(occupancy(&db, &channel, &ids[0], device).await, 2);
        for denied in [LISTEN, READ] {
            policy.overrides = vec![PermissionOverride {
                channel_id: channel.clone(),
                kind: OverrideKind::Member,
                target_id: ids[3].clone(),
                allow: 0,
                deny: denied,
            }];
            sqlx::query("UPDATE communities SET governance=$2 WHERE id=$1")
                .bind(&community)
                .bind(json!(policy))
                .execute(&db)
                .await
                .unwrap();
            insert(&db, &channel, &ids[3], &presences[3]).await;
            assert_eq!(occupancy(&db, &channel, &ids[0], device).await, 1);
        }
        policy.overrides.clear();
        policy.sanctions = vec![Sanction {
            account_id: ids[3].clone(),
            channel_id: None,
            kind: SanctionKind::Kick,
            until: None,
            kick_after: Some(100),
        }];
        let access = ChannelAccess {
            community_id: community,
            owner_id: ids[0].clone(),
            announcement: false,
            kind: ChannelKind::Stage,
            authority: None,
            policy: None,
            governance: Some(policy),
        };
        assert!(!peer_permitted(
            &access,
            &channel,
            &ids[3],
            Some(100),
            true,
            200
        ));
        assert!(peer_permitted(
            &access,
            &channel,
            &ids[3],
            Some(101),
            true,
            200
        ));
        assert!(!peer_permitted(
            &access,
            &channel,
            &ids[3],
            Some(101),
            false,
            200
        ));
    }
}
