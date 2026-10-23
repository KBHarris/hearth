# Private attachment storage

Stage 4 implementation started 2026-10-20 with provider-configurable S3 storage.
All file contents, previews, names and keys remain encrypted by clients. The
backend authorizes object leases and checks ciphertext length; recipients verify
ciphertext integrity locally.

## Server settings

Set these on the **backend process/service**. With none of these settings present,
attachments are disabled. Any partial configuration or empty value fails startup
instead of silently disabling storage. Errors identify setting names without
echoing credential values or endpoint URLs.

| Environment variable | Meaning | Default |
| --- | --- | --- |
| `HEARTH_S3_ENDPOINT` | Base S3 origin reachable by the backend, for verification and deletion. | Required when storage is enabled. |
| `HEARTH_S3_PUBLIC_ENDPOINT` | Base origin reachable by clients; signs uploads/downloads. HTTPS required except loopback development. | Required. |
| `HEARTH_S3_ACCESS_KEY` | Provider-issued access key ID. | Required. |
| `HEARTH_S3_SECRET_KEY` | Provider-issued secret access key. | Required. |
| `HEARTH_S3_BUCKET` | Actual S3 bucket name, rather than a provider's display name. | `hearth-blobs` |
| `HEARTH_S3_REGION` | Signing region, including provider-specific values such as `auto`. | `us-east-1` |
| `HEARTH_S3_URL_STYLE` | `path` or `virtual-hosted`. | `path` |
| `HEARTH_S3_CREATE_BUCKET` | `true` creates a missing bucket; `false` uses a provisioned bucket without bucket-level API calls. | `true` |

Path style produces `https://files.example.org/bucket/object`; virtual-hosted
style produces `https://bucket.files.example.org/object`. Supply base origins
without bucket subdomains, credentials, paths, query strings or fragments. Both
backend and public endpoints use the same bucket name, region and URL style.
Virtual-hosted mode requires DNS endpoints and a bucket name without dots; this
avoids the extra TLS certificate requirements of nested bucket subdomains.

Access keys are opaque provider values: Hearth requires nonempty printable ASCII
without whitespace, rather than a particular provider's credential lengths.
`deploy/setup.mjs` continues generating random local credentials. Credentials
belong in provider secrets/operator configuration; never put them in the client
bundle, source, ordinary logs or diagnostics. Temporary session-token credentials
are not supported by this configuration.

`false` disables bucket provisioning and bucket-level probes. It allows credentials
scoped to object operations and does **not** prove that the bucket exists or works.
The provider must provision it first; confirm actual signed PUT, authenticated
HEAD/GET and DELETE through the application. Health/discovery alone does not
establish storage readiness. With creation enabled, access denial never causes a
create attempt, and a creation conflict requires a successful authenticated HEAD
before treating the race as recovered.

## Railway mapping

Provider documentation rechecked 2026-10-20:
[bucket credentials and URL style](https://docs.railway.com/storage-buckets),
[presigned uploads/downloads](https://docs.railway.com/storage-buckets/uploading-serving).
These settings prepare the backend; Railway provisioning and real-provider
acceptance remain open.

Map the bucket resource's `BUCKET`, `REGION`, `ENDPOINT`, `ACCESS_KEY_ID` and
`SECRET_ACCESS_KEY` references to the corresponding Hearth settings above. Use
`ENDPOINT` for both endpoint settings when it is public HTTPS. Set
`HEARTH_S3_CREATE_BUCKET=false`. New Railway buckets usually require
`HEARTH_S3_URL_STYLE=virtual-hosted`; use the style reported in the bucket's
Credentials tab, since older buckets may require `path`. `BUCKET` is the actual
S3 name; `RAILWAY_BUCKET_NAME` is a display name.

Keep the bucket private. Browser use also needs provider CORS allowing the exact
client origins, PUT/GET and the `Content-Type` upload header. Verify the browser's
generated `Content-Length` matches the signed ciphertext length; the plaintext
50,000,000-byte boundary encrypts to 50,000,768 bytes. Provider CORS configuration,
browser preflights and these transfers still require real Railway testing.

## Local Compose compatibility and verification

The bundled Compose/HTTPS setup keeps its existing SeaweedFS defaults and
`hearth-blobs` proxy route. The new settings are backend-service settings; adding
them to `deploy/.env` alone does not replace the bundled store or proxy. A cloud
deployment should configure the backend directly with its managed bucket.

Run `cargo test -p hearth-server --lib` for configuration, URL-signing and
loopback HTTP mock checks. Run `npm run test:storage` with Docker available for a
disposable private SeaweedFS bucket: custom-bucket provisioning, existing-bucket
transfers through the ciphertext size limit, signature/expiry/access rejection
and deletion. The generated report is under `target/storage-acceptance/` and
contains no credentials. The fixture removes its own container and secret file.

For application encryption, permission, retention and deletion regressions, run
`node scripts/verify-auth.mjs --phase3 --storage` against its disposable database
and private S3 fixtures. These commands use local resources. Neither local
SeaweedFS nor generated virtual-hosted URLs prove a real Railway deployment.
