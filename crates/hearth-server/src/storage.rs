//! S3 provider configuration. Credentials and endpoint capabilities never enter diagnostics.
use anyhow::{Context, ensure};
use axum::http::StatusCode;
use s3::{Bucket, Region, bucket_ops::BucketConfiguration, creds::Credentials};

type Result<T> = std::result::Result<T, StatusCode>;

#[cfg(test)]
mod tests;

#[derive(Clone, Copy, PartialEq, Eq)]
enum UrlStyle {
    Path,
    VirtualHosted,
}

#[derive(Clone)]
pub struct StorageConfig {
    pub endpoint: String,
    pub public_endpoint: String,
    pub access_key: String,
    pub secret_key: String,
    bucket_name: String,
    region: String,
    url_style: UrlStyle,
    create_bucket: bool,
}

impl std::fmt::Debug for StorageConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("StorageConfig([redacted])")
    }
}

impl StorageConfig {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        Self::from_lookup(|name| match std::env::var(name) {
            Ok(value) => Ok(Some(value)),
            Err(std::env::VarError::NotPresent) => Ok(None),
            Err(_) => anyhow::bail!("{name} must contain valid Unicode"),
        })
    }

    // Lookup injection avoids changing process-global environment in concurrent tests.
    fn from_lookup(
        mut lookup: impl FnMut(&str) -> anyhow::Result<Option<String>>,
    ) -> anyhow::Result<Option<Self>> {
        const NAMES: [&str; 8] = [
            "HEARTH_S3_ENDPOINT",
            "HEARTH_S3_PUBLIC_ENDPOINT",
            "HEARTH_S3_ACCESS_KEY",
            "HEARTH_S3_SECRET_KEY",
            "HEARTH_S3_BUCKET",
            "HEARTH_S3_REGION",
            "HEARTH_S3_URL_STYLE",
            "HEARTH_S3_CREATE_BUCKET",
        ];
        let mut values = std::collections::HashMap::new();
        for name in NAMES {
            if let Some(value) = lookup(name)? {
                ensure!(!value.is_empty(), "{name} must not be empty");
                values.insert(name, value);
            }
        }
        if values.is_empty() {
            return Ok(None);
        }
        let required = |name| {
            values
                .get(name)
                .cloned()
                .with_context(|| format!("{name} is required when S3 is configured"))
        };
        let optional = |name, default: &str| {
            values
                .get(name)
                .cloned()
                .unwrap_or_else(|| default.to_owned())
        };
        let config = Self {
            endpoint: required("HEARTH_S3_ENDPOINT")?,
            public_endpoint: required("HEARTH_S3_PUBLIC_ENDPOINT")?,
            access_key: required("HEARTH_S3_ACCESS_KEY")?,
            secret_key: required("HEARTH_S3_SECRET_KEY")?,
            bucket_name: optional("HEARTH_S3_BUCKET", "hearth-blobs"),
            region: optional("HEARTH_S3_REGION", "us-east-1"),
            url_style: match optional("HEARTH_S3_URL_STYLE", "path").as_str() {
                "path" => UrlStyle::Path,
                "virtual-hosted" => UrlStyle::VirtualHosted,
                _ => anyhow::bail!("HEARTH_S3_URL_STYLE must be path or virtual-hosted"),
            },
            create_bucket: match optional("HEARTH_S3_CREATE_BUCKET", "true").as_str() {
                "true" => true,
                "false" => false,
                _ => anyhow::bail!("HEARTH_S3_CREATE_BUCKET must be true or false"),
            },
        };
        config.validate()?;
        Ok(Some(config))
    }

    fn validate(&self) -> anyhow::Result<()> {
        // DNS-compatible names also prevent bucket names from injecting paths or hosts.
        ensure!(
            (3..=63).contains(&self.bucket_name.len())
                && self.bucket_name.split('.').all(|label| {
                    !label.is_empty()
                        && label.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
                        && label.ends_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
                        && label
                            .bytes()
                            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
                })
                && self.bucket_name.parse::<std::net::Ipv4Addr>().is_err(),
            "HEARTH_S3_BUCKET must be a DNS-compatible S3 bucket name"
        );
        ensure!(
            self.region.len() <= 64
                && self
                    .region
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.')),
            "HEARTH_S3_REGION must be a signing region without whitespace or slashes"
        );
        for (name, value, public) in [
            ("HEARTH_S3_ENDPOINT", &self.endpoint, false),
            ("HEARTH_S3_PUBLIC_ENDPOINT", &self.public_endpoint, true),
        ] {
            let uri: axum::http::Uri = value
                .parse()
                .map_err(|_| anyhow::anyhow!("{name} must be an HTTP(S) origin"))?;
            ensure!(
                uri.authority().is_some()
                    && uri
                        .host()
                        .is_some_and(|host| !host.is_empty() && host != "*")
                    && uri.path() == "/"
                    && uri.query().is_none()
                    && !value.contains(['@', '#'])
                    && matches!(uri.scheme_str(), Some("http" | "https")),
                "{name} must be an HTTP(S) origin without credentials, paths, queries or fragments"
            );
            ensure!(
                !public
                    || uri.scheme_str() == Some("https")
                    || matches!(uri.host(), Some("127.0.0.1" | "localhost" | "[::1]")),
                "HEARTH_S3_PUBLIC_ENDPOINT requires HTTPS or loopback"
            );
            if self.url_style == UrlStyle::VirtualHosted {
                let host = uri.host().unwrap_or_default();
                ensure!(
                    host.parse::<std::net::IpAddr>().is_err()
                        && !host.contains(['[', ']'])
                        && !host.starts_with(&format!("{}.", self.bucket_name))
                        && !self.bucket_name.contains('.'),
                    "virtual-hosted S3 requires a base DNS endpoint and a bucket name without dots"
                );
            }
        }
        // Provider-issued credentials are opaque. Local setup still generates random keys.
        for (name, value) in [
            ("HEARTH_S3_ACCESS_KEY", &self.access_key),
            ("HEARTH_S3_SECRET_KEY", &self.secret_key),
        ] {
            ensure!(
                value.bytes().all(|c| c.is_ascii_graphic()),
                "{name} must not contain whitespace or control characters"
            );
        }
        Ok(())
    }

    fn credentials(&self) -> Result<Credentials> {
        Credentials::new(
            Some(&self.access_key),
            Some(&self.secret_key),
            None,
            None,
            None,
        )
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
    }

    fn region(&self, public: bool) -> Region {
        Region::Custom {
            region: self.region.clone(),
            endpoint: if public {
                &self.public_endpoint
            } else {
                &self.endpoint
            }
            .clone(),
        }
    }

    pub(crate) fn bucket(&self, public: bool) -> Result<Box<Bucket>> {
        let bucket = Bucket::new(&self.bucket_name, self.region(public), self.credentials()?)
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        Ok(match self.url_style {
            UrlStyle::Path => bucket.with_path_style(),
            UrlStyle::VirtualHosted => bucket,
        })
    }

    pub(crate) async fn ensure_bucket(&self) -> Result<()> {
        if !self.create_bucket {
            // Managed credentials may only permit object operations. Do not require
            // HeadBucket/ListBucket/CreateBucket or mutate provider-managed resources.
            // Actual upload/completion remains the storage readiness check.
            return Ok(());
        }
        let bucket = self.bucket(false)?;
        let (_, status) = bucket
            .head_object("")
            .await
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        if status == 200 {
            return Ok(());
        }
        if status != 404 {
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
        let credentials = self.credentials()?;
        let result = match self.url_style {
            UrlStyle::Path => {
                Bucket::create_with_path_style(
                    &self.bucket_name,
                    self.region(false),
                    credentials,
                    BucketConfiguration::default(),
                )
                .await
            }
            UrlStyle::VirtualHosted => {
                Bucket::create(
                    &self.bucket_name,
                    self.region(false),
                    credentials,
                    BucketConfiguration::default(),
                )
                .await
            }
        }
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        match result.response_code {
            200 | 204 => Ok(()),
            409 => {
                // A simultaneous local creator can win. A name conflict alone is
                // insufficient evidence that our credentials can access that bucket.
                let (_, status) = bucket
                    .head_object("")
                    .await
                    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
                if status == 200 {
                    Ok(())
                } else {
                    Err(StatusCode::SERVICE_UNAVAILABLE)
                }
            }
            _ => Err(StatusCode::SERVICE_UNAVAILABLE),
        }
    }
}
