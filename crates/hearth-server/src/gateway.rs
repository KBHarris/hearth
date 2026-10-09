//! Authenticated per-device ordered delivery. Resume cursors come from the sealed client store.
use crate::SharedState;
use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode, header},
    response::Response,
};
use hearth_proto::{
    PROTOCOL_VERSION,
    gateway::{ClientFrame, ServerFrame},
};
use sha2::{Digest, Sha256};
use tokio::time::{Duration, Instant};
const HEARTBEAT_INTERVAL_MS: u64 = 30_000;

pub async fn upgrade(
    ws: WebSocketUpgrade,
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    if let Some(origin) = headers.get(header::ORIGIN) {
        let origin = origin.to_str().map_err(|_| StatusCode::FORBIDDEN)?;
        if !state
            .config
            .client_origins
            .iter()
            .any(|allowed| allowed == origin)
        {
            return Err(StatusCode::FORBIDDEN);
        }
    }
    let permit = state.auth.admit_gateway()?;
    Ok(ws
        .max_message_size(16384)
        .max_frame_size(16384)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            handle(socket, state).await
        }))
}
struct Connection {
    hash: Vec<u8>,
    account: String,
    device: String,
    session: String,
    sent: u64,
    acked: u64,
    resumed: bool,
}
async fn identify(
    state: &SharedState,
    challenge: &str,
    protocol: u32,
    token: &str,
    device: String,
    signature: &str,
) -> Result<Connection, ()> {
    if protocol != PROTOCOL_VERSION {
        return Err(());
    }
    hearth_crypto::messaging::verify_gateway(
        &device,
        signature,
        token,
        challenge,
        &state.server_key.public().to_hex(),
    )
    .map_err(|_| ())?;
    let hash = Sha256::digest(token.as_bytes()).to_vec();
    let account: String = sqlx::query_scalar(
        "SELECT account_id FROM auth_sessions WHERE token_hash=$1 AND expires_at>now()",
    )
    .bind(&hash)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ())?
    .ok_or(())?;
    state.auth.limit_delivery(&account).map_err(|_| ())?;
    crate::delivery::approved(state, &account, &device)
        .await
        .map_err(|_| ())?;
    let session = hex::encode(Sha256::digest(format!(
        "hearth/v1/gateway-session:{}:{account}:{device}",
        state.server_key.public().to_hex()
    )));
    Ok(Connection {
        hash,
        account,
        device,
        session,
        sent: 0,
        acked: 0,
        resumed: false,
    })
}
async fn handle(mut socket: WebSocket, state: SharedState) {
    let hello = ServerFrame::Hello {
        protocol: PROTOCOL_VERSION,
        heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
    };
    let challenge = hearth_crypto::messaging::random_id();
    if send(&mut socket, &hello).await.is_err()
        || send(
            &mut socket,
            &ServerFrame::Challenge {
                challenge: challenge.clone(),
            },
        )
        .await
        .is_err()
    {
        return;
    }
    let started = Instant::now();
    let mut heartbeat = started;
    let mut tick = tokio::time::interval(Duration::from_millis(200));
    let mut connection: Option<Connection> = None;
    let mut since = Instant::now();
    let mut frame_count = 0;
    loop {
        let result: Result<(), ()> = tokio::select! {
            frame=socket.recv()=>async {
                let Some(Ok(Message::Text(text)))=frame else { return Err(()) };
                if since.elapsed()>Duration::from_secs(60) { since=Instant::now();frame_count=0; }
                frame_count+=1; if frame_count>600 { return Err(()) }
                let frame=serde_json::from_str::<ClientFrame>(&text).map_err(|_|())?;
                match frame {
                    ClientFrame::Identify { protocol,token,device_key,signature }=>{
                        if connection.is_some() { return Err(()); }
                        let next=identify(&state,&challenge,protocol,&token,device_key,&signature).await?;
                        send(&mut socket,&ServerFrame::Ready { session_id:next.session.clone() }).await?;
                        connection=Some(next);
                    },
                    ClientFrame::Resume { session_id,last_seq }=>{
                        let client=connection.as_mut().ok_or(())?;
                        if client.resumed || session_id!=client.session || last_seq>9_007_199_254_740_991 { return Err(()); }
                        let maximum:Option<i64>=sqlx::query_scalar("SELECT next_seq-1 FROM device_delivery_cursors WHERE device_key=$1").bind(&client.device).fetch_optional(&state.db).await.map_err(|_|())?;
                        if last_seq>maximum.unwrap_or(0) as u64 { return Err(()); }
                        client.sent=last_seq;client.acked=last_seq;client.resumed=true;
                    },
                    ClientFrame::Ack { last_seq }=>{
                        let client=connection.as_mut().ok_or(())?;
                        if !client.resumed || last_seq<client.acked || last_seq>client.sent { return Err(()); }
                        client.acked=last_seq;
                    },
                    ClientFrame::Heartbeat { last_seq }=>{
                        let client=connection.as_mut().ok_or(())?;
                        if let Some(seq)=last_seq {
                            if seq<client.acked || seq>client.sent { return Err(()); }
                            client.acked=seq;
                        }
                        heartbeat=Instant::now();send(&mut socket,&ServerFrame::HeartbeatAck).await?;
                    },
                }
                Ok(())
            }.await,
            _=tick.tick()=>async {
                if heartbeat.elapsed()>Duration::from_secs(65) { return Err(()); }
                if connection.as_ref().is_none_or(|client|!client.resumed) && started.elapsed()>Duration::from_secs(8) { return Err(()); }
                if let Some(client)=connection.as_mut() {
                    let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM auth_sessions WHERE token_hash=$1 AND account_id=$2 AND expires_at>now())")
                        .bind(&client.hash).bind(&client.account).fetch_one(&state.db).await.map_err(|_|())?;
                    if !valid { return Err(()); }
                    if client.resumed && client.sent-client.acked<128 {
                        let events=crate::delivery::backlog(&state,&client.device,client.sent).await.map_err(|_|())?;
                        for event in events.into_iter().take((128-(client.sent-client.acked)) as usize) {
                            if event.seq!=client.sent+1 { return Err(()); }
                            send(&mut socket,&ServerFrame::Event { seq:event.seq,event:serde_json::to_value(&event).map_err(|_|())? }).await?;
                            client.sent=event.seq;
                        }
                    }
                }
                Ok(())
            }.await,
        };
        if result.is_err() {
            let _=send(&mut socket,&ServerFrame::InvalidSession { reason:"Authentication, delivery cursor or heartbeat could not be verified. Reconnect and sign in if needed.".into() }).await;
            break;
        }
    }
    let _ = tokio::time::timeout(Duration::from_secs(2), socket.send(Message::Close(None))).await;
}
async fn send(socket: &mut WebSocket, frame: &ServerFrame) -> Result<(), ()> {
    let text = serde_json::to_string(frame).map_err(|_| ())?;
    tokio::time::timeout(
        Duration::from_secs(5),
        socket.send(Message::Text(text.into())),
    )
    .await
    .map_err(|_| ())?
    .map_err(|_| ())
}
