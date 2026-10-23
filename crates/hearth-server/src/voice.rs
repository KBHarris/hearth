//! Bounded public voice occupancy. Media and SDP never enter this module.
use crate::{SharedState, community::channel_access, delivery::approved};
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

async fn permitted(tx: &mut PgConnection, channel: &str, account: &str) -> Result<(u32, String)> {
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
            .map(|policy| policy.signature)
            .unwrap_or_default(),
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
    let (_, policy_signature) = permitted(tx, channel, account).await?;
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
    let mut removed = false;
    for entry in entries {
        let mut presence: VoicePresence = serde_json::from_value(entry.get("presence"))
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        if presence.active
            && (presence.expires_at <= now()
                || !devices.contains(&presence.device_key)
                || permitted(tx, channel, entry.get("account_id"))
                    .await
                    .is_err())
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
    let (permissions, _) = permitted(&mut tx, &channel, &account).await?;
    let result = config
        .access(&current, &device, now(), permissions)
        .map_err(|_| StatusCode::FORBIDDEN)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(result))
}
