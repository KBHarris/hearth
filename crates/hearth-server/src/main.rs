use std::sync::Arc;

use anyhow::Context;
use sqlx::postgres::PgPoolOptions;
use tracing_subscriber::EnvFilter;

use hearth_server::{AppState, config::Config, keys, router};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let config = Config::from_env()?;
    let directory = config
        .server_key_path
        .parent()
        .context("server key needs a parent directory")?;
    if std::env::args().nth(1).as_deref() == Some("--setup-code") {
        // Operator-only CLI, never a log line or network endpoint.
        print!("{}", std::fs::read_to_string(directory.join("setup.code"))?);
        return Ok(());
    }

    let db = PgPoolOptions::new()
        .max_connections(config.db_max_connections)
        .connect(&config.database_url)
        .await
        .context("connecting to PostgreSQL")?;
    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .context("running migrations")?;

    let has_accounts: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM accounts)")
        .fetch_one(&db)
        .await?;
    if has_accounts
        && (!config.server_key_path.exists() || !directory.join("opaque.setup").exists())
    {
        anyhow::bail!(
            "authentication keys are missing for an existing account database; restore the matching server-data backup instead of generating new keys"
        );
    }
    let server_key = keys::load_or_create(&config.server_key_path)?;
    let auth = hearth_server::auth::AuthState::load(directory)?;

    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    tracing::info!(addr = %config.bind, server_name = %config.server_name, "hearth-server listening");

    let cleanup_db = db.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            if hearth_server::auth::cleanup_expired(&cleanup_db)
                .await
                .is_err()
            {
                tracing::warn!("expired authentication state cleanup unavailable");
            }
        }
    });

    let state = Arc::new(AppState {
        config,
        db,
        server_key,
        auth,
    });
    let cleanup_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            if hearth_server::attachments::cleanup_expired(&cleanup_state)
                .await
                .is_err()
            {
                tracing::warn!("expired encrypted upload cleanup unavailable");
            }
            if hearth_server::retention::cleanup(&cleanup_state)
                .await
                .is_err()
            {
                tracing::warn!("retained ciphertext cleanup unavailable");
            }
        }
    });
    axum::serve(listener, router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
