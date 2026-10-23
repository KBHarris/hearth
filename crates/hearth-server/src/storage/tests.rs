use super::*;
use axum::{Router, body::Body, http::Request, routing::any};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

fn settings(overrides: &[(&str, &str)]) -> anyhow::Result<Option<StorageConfig>> {
    let mut values = std::collections::HashMap::from([
        ("HEARTH_S3_ENDPOINT", "http://storage:8333"),
        ("HEARTH_S3_PUBLIC_ENDPOINT", "https://files.example.org"),
        ("HEARTH_S3_ACCESS_KEY", "provider-key"),
        ("HEARTH_S3_SECRET_KEY", "provider-secret"),
    ]);
    values.extend(overrides.iter().copied());
    StorageConfig::from_lookup(|name| Ok(values.get(name).map(|value| (*value).to_owned())))
}

#[test]
fn absent_storage_is_disabled_but_partial_or_empty_configuration_fails() {
    assert!(StorageConfig::from_lookup(|_| Ok(None)).unwrap().is_none());
    for name in [
        "HEARTH_S3_BUCKET",
        "HEARTH_S3_ACCESS_KEY",
        "HEARTH_S3_ENDPOINT",
    ] {
        assert!(
            StorageConfig::from_lookup(|key| Ok((key == name).then(|| "configured".into())))
                .is_err()
        );
    }
    for name in [
        "HEARTH_S3_ENDPOINT",
        "HEARTH_S3_PUBLIC_ENDPOINT",
        "HEARTH_S3_ACCESS_KEY",
        "HEARTH_S3_SECRET_KEY",
        "HEARTH_S3_BUCKET",
        "HEARTH_S3_REGION",
        "HEARTH_S3_URL_STYLE",
        "HEARTH_S3_CREATE_BUCKET",
    ] {
        assert!(settings(&[(name, "")]).is_err(), "empty {name}");
    }
}

#[test]
fn local_defaults_preserve_seaweed_bucket_region_and_addressing() {
    let config = settings(&[]).unwrap().unwrap();
    assert!(config.create_bucket);
    assert_eq!(
        config.bucket(false).unwrap().url(),
        "http://storage:8333/hearth-blobs"
    );
    assert_eq!(
        config.bucket(true).unwrap().url(),
        "https://files.example.org/hearth-blobs"
    );
    assert_eq!(config.bucket(true).unwrap().region.to_string(), "us-east-1");
}

#[test]
fn malformed_configuration_fails_without_echoing_values() {
    for (name, value) in [
        ("HEARTH_S3_BUCKET", "Bad-Name"),
        ("HEARTH_S3_BUCKET", "ab"),
        ("HEARTH_S3_BUCKET", "a..b"),
        ("HEARTH_S3_BUCKET", "a.-bad"),
        ("HEARTH_S3_BUCKET", "127.0.0.1"),
        ("HEARTH_S3_BUCKET", "bucket/path"),
        ("HEARTH_S3_REGION", "region/scope"),
        ("HEARTH_S3_REGION", "region with space"),
        ("HEARTH_S3_URL_STYLE", "typo"),
        ("HEARTH_S3_CREATE_BUCKET", "yes"),
        ("HEARTH_S3_ACCESS_KEY", "key\nsecret-canary"),
        ("HEARTH_S3_SECRET_KEY", "secret canary"),
        (
            "HEARTH_S3_ENDPOINT",
            "https://user:secret-canary@files.example.org",
        ),
        ("HEARTH_S3_ENDPOINT", "https://files.example.org/path"),
        (
            "HEARTH_S3_PUBLIC_ENDPOINT",
            "https://files.example.org?secret-canary",
        ),
        (
            "HEARTH_S3_PUBLIC_ENDPOINT",
            "https://files.example.org#secret-canary",
        ),
        ("HEARTH_S3_PUBLIC_ENDPOINT", "http://files.example.org"),
    ] {
        let error = settings(&[(name, value)]).unwrap_err();
        assert!(!format!("{error:#}").contains(value), "error echoed {name}");
    }
    let config = settings(&[]).unwrap().unwrap();
    assert_eq!(format!("{config:?}"), "StorageConfig([redacted])");
    assert!(settings(&[("HEARTH_S3_PUBLIC_ENDPOINT", "http://127.0.0.1:8333")]).is_ok());
    assert!(settings(&[("HEARTH_S3_PUBLIC_ENDPOINT", "http://[::1]:8333")]).is_ok());
}

#[test]
fn virtual_hosted_style_requires_base_dns_endpoints_and_one_bucket_label() {
    for (name, value) in [
        ("HEARTH_S3_ENDPOINT", "http://127.0.0.1:8333"),
        ("HEARTH_S3_PUBLIC_ENDPOINT", "https://[::1]"),
        (
            "HEARTH_S3_ENDPOINT",
            "https://hearth-blobs.storage.example.org",
        ),
        ("HEARTH_S3_BUCKET", "dotted.bucket"),
    ] {
        assert!(settings(&[("HEARTH_S3_URL_STYLE", "virtual-hosted"), (name, value)]).is_err());
    }
}

#[tokio::test]
async fn presigned_urls_use_public_endpoint_configured_bucket_region_and_style() {
    for style in ["path", "virtual-hosted"] {
        let config = settings(&[
            ("HEARTH_S3_BUCKET", "uploads-provider-id"),
            ("HEARTH_S3_REGION", "auto"),
            ("HEARTH_S3_URL_STYLE", style),
            ("HEARTH_S3_CREATE_BUCKET", "false"),
        ])
        .unwrap()
        .unwrap();
        let bucket = config.bucket(true).unwrap();
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("content-type", "application/octet-stream".parse().unwrap());
        headers.insert("content-length", "1234".parse().unwrap());
        let put = bucket
            .presign_put("conversation/blob", 300, Some(headers), None)
            .await
            .unwrap();
        let get = bucket
            .presign_get("conversation/blob", 300, None)
            .await
            .unwrap();
        for (signed, is_put) in [(&get, false), (&put, true)] {
            let url = reqwest::Url::parse(signed).unwrap();
            let (host, path) = if style == "path" {
                (
                    "files.example.org",
                    "/uploads-provider-id/conversation/blob",
                )
            } else {
                (
                    "uploads-provider-id.files.example.org",
                    "/conversation/blob",
                )
            };
            assert_eq!(url.scheme(), "https");
            assert_eq!(url.host_str(), Some(host));
            assert_eq!(url.path(), path);
            let params: std::collections::HashMap<_, _> = url.query_pairs().collect();
            assert_eq!(params["X-Amz-Expires"], "300");
            assert!(params["X-Amz-Credential"].starts_with("provider-key/"));
            assert!(params["X-Amz-Credential"].ends_with("/auto/s3/aws4_request"));
            assert!(!params["X-Amz-Signature"].is_empty());
            assert!(!signed.contains("provider-secret") && !signed.contains("storage:8333"));
            if is_put {
                assert!(params["X-Amz-SignedHeaders"].contains("content-type"));
                assert!(params["X-Amz-SignedHeaders"].contains("content-length"));
            }
        }
        let internal = config.bucket(false).unwrap().url();
        assert_eq!(
            internal,
            if style == "path" {
                "http://storage:8333/uploads-provider-id"
            } else {
                "http://uploads-provider-id.storage:8333"
            }
        );
    }
}

struct MockS3 {
    endpoint: String,
    requests: Arc<Mutex<Vec<(String, String)>>>,
    responses: Arc<Mutex<VecDeque<u16>>>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for MockS3 {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl MockS3 {
    async fn start(statuses: &[u16]) -> Self {
        let responses = Arc::new(Mutex::new(VecDeque::from(statuses.to_vec())));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let capture = requests.clone();
        let queued = responses.clone();
        let app = Router::new().fallback(any(move |request: Request<Body>| {
            let capture = capture.clone();
            let queued = queued.clone();
            async move {
                capture.lock().unwrap().push((
                    request.method().to_string(),
                    request.uri().path().to_string(),
                ));
                let status = queued.lock().unwrap().pop_front().unwrap_or(500);
                (StatusCode::from_u16(status).unwrap(), "")
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self {
            endpoint,
            requests,
            responses,
            task,
        }
    }

    fn config(&self, create: bool) -> StorageConfig {
        settings(&[
            ("HEARTH_S3_ENDPOINT", &self.endpoint),
            ("HEARTH_S3_BUCKET", "custom-bucket"),
            ("HEARTH_S3_REGION", "test-region"),
            (
                "HEARTH_S3_CREATE_BUCKET",
                if create { "true" } else { "false" },
            ),
        ])
        .unwrap()
        .unwrap()
    }

    fn assert_requests(&self, methods: &[&str]) {
        assert_eq!(
            *self.requests.lock().unwrap(),
            methods
                .iter()
                .map(|method| (
                    (*method).to_owned(),
                    if *method == "PUT" {
                        "/custom-bucket"
                    } else {
                        "/custom-bucket/"
                    }
                    .to_owned()
                ))
                .collect::<Vec<_>>()
        );
        assert!(self.responses.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn managed_bucket_does_not_issue_bucket_operations() {
    let mock = MockS3::start(&[]).await;
    let config = mock.config(false);
    config.ensure_bucket().await.unwrap();
    config.ensure_bucket().await.unwrap();
    mock.assert_requests(&[]);
}

#[tokio::test]
async fn local_bucket_creation_and_retry_use_the_configured_bucket() {
    let mock = MockS3::start(&[404, 200, 200]).await;
    let config = mock.config(true);
    config.ensure_bucket().await.unwrap();
    config.ensure_bucket().await.unwrap();
    mock.assert_requests(&["HEAD", "PUT", "HEAD"]);
}

#[tokio::test]
async fn bucket_creation_denials_and_service_errors_fail_closed() {
    for status in [301, 403, 500] {
        let mock = MockS3::start(&[status]).await;
        assert_eq!(
            mock.config(true).ensure_bucket().await,
            Err(StatusCode::SERVICE_UNAVAILABLE)
        );
        mock.assert_requests(&["HEAD"]);
    }
    let mock = MockS3::start(&[404, 403]).await;
    assert_eq!(
        mock.config(true).ensure_bucket().await,
        Err(StatusCode::SERVICE_UNAVAILABLE)
    );
    mock.assert_requests(&["HEAD", "PUT"]);
}

#[tokio::test]
async fn a_creation_conflict_requires_authenticated_access_before_success() {
    for status in [200, 403, 404] {
        let mock = MockS3::start(&[404, 409, status]).await;
        let result = mock.config(true).ensure_bucket().await;
        assert_eq!(result.is_ok(), status == 200);
        mock.assert_requests(&["HEAD", "PUT", "HEAD"]);
    }
}

#[tokio::test]
#[ignore = "requires the disposable private S3 fixture: npm run test:storage"]
async fn private_s3_existing_bucket_round_trip_and_cleanup() {
    use sha2::{Digest, Sha256};
    let mut config = StorageConfig::from_env().unwrap().unwrap();
    // Guard against accidentally pointing the opt-in test at operator storage.
    assert!(config.bucket_name.starts_with("hearth-storage-test-"));
    assert_eq!(config.url_style as u8, UrlStyle::Path as u8);
    for endpoint in [&config.endpoint, &config.public_endpoint] {
        let url = reqwest::Url::parse(endpoint).unwrap();
        assert_eq!(url.host_str(), Some("127.0.0.1"));
    }
    config.create_bucket = true;
    config.ensure_bucket().await.unwrap();
    config.create_bucket = false;
    config.ensure_bucket().await.unwrap();
    let bucket = config.bucket(true).unwrap();
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap();
    assert_eq!(
        http.get(bucket.url()).send().await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    // Opaque bytes exercise provider transfer limits. Product crypto is checked
    // separately by the existing HTTP/WASM/private-S3 acceptance suite.
    let payload = vec![0xa7; hearth_proto::messaging::MAX_ATTACHMENT_CIPHER_BYTES as usize];
    let digest = Sha256::digest(&payload);
    let key = "opaque-conversation/opaque-blob";
    let mut headers = axum::http::HeaderMap::new();
    headers.insert("content-length", payload.len().to_string().parse().unwrap());
    headers.insert("content-type", "application/octet-stream".parse().unwrap());
    let upload = bucket
        .presign_put(key, 300, Some(headers), None)
        .await
        .unwrap();
    let rejected = http
        .put(&upload)
        .header("content-type", "application/octet-stream")
        .body("wrong length")
        .send()
        .await
        .unwrap();
    assert!(!rejected.status().is_success());
    assert!(
        http.put(&upload)
            .header("content-type", "application/octet-stream")
            .body(payload)
            .send()
            .await
            .unwrap()
            .status()
            .is_success()
    );
    let download = bucket.presign_get(key, 300, None).await.unwrap();
    let response = http.get(&download).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(Sha256::digest(response.bytes().await.unwrap()), digest);
    let unsigned = download.split('?').next().unwrap();
    assert_eq!(
        http.get(unsigned).send().await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let mut tampered = reqwest::Url::parse(&download).unwrap();
    let query = tampered
        .query_pairs()
        .map(|(name, value)| {
            let value = if name == "X-Amz-Signature" {
                "0".repeat(64)
            } else {
                value.into_owned()
            };
            (name.into_owned(), value)
        })
        .collect::<Vec<_>>();
    tampered.set_query(None);
    tampered.query_pairs_mut().extend_pairs(query);
    assert_eq!(
        http.get(tampered).send().await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let expiring = bucket.presign_get(key, 1, None).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    assert_eq!(
        http.get(expiring).send().await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let removed = config
        .bucket(false)
        .unwrap()
        .delete_object(key)
        .await
        .unwrap();
    assert!(matches!(removed.status_code(), 200 | 204));
    assert_eq!(
        http.get(download).send().await.unwrap().status(),
        StatusCode::NOT_FOUND
    );
}
