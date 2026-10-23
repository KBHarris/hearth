# Cloud deployment development

Updated 2026-10-20. The Railway definition, local deployment command, production
web image and server-volume entrypoint are implemented. Linux Docker/Chromium
acceptance is local evidence. No Railway resources have been provisioned; the
user selected **keep it local** on 2026-10-20. Live provisioning requires a later
explicit request. [Phase 4](PHASE4_HOSTING_AND_MEDIA.md) tracks the remaining gates.

## Reviewed resource definition

`.railway/railway.ts` uses the native `railway/iac` SDK, pinned to 3.16.0. The
project-local CLI is 5.71.0; `deploy/railway/cli.mjs` verifies its official release
archive against committed SHA-256 digests before extraction. It does not replace
the user's global CLI. Its installer uses the system archive tool rather than
the deprecated transitive archive library in Railway's npm CLI installer.

The public settings in `.railway/hearth.json` select project/environment, region,
bucket region, server-volume size, optional website and extra exact HTTPS client
origins. They contain no credentials. The native definition describes:

| Resource | Configuration |
| --- | --- |
| `postgres` | Pinned provider PostgreSQL 18 image, explicit data directory, private networking with no public domains/TCP proxies declared. |
| `attachments` | Private bucket with credentials passed to the backend through resource references. |
| `server-data` | 1 GB volume mounted at `/var/lib/hearth`, colocated with the single backend replica. |
| `hearth` | Root Docker build context, explicit server Dockerfile, dual-stack port 8080, runtime migrations and `/health` readiness. Federation disabled. |
| `web` (optional) | Root Docker build context, production UI/WASM image, private upstream to `hearth`, `/web-health` readiness. |

The provider database helper owns database provisioning and its database volume;
the server-key volume is separate. Storage regions cannot be changed in place.
The current default application region is `us-west2`, bucket region `iad`.
These are configuration choices, without measured hosting/bandwidth costs.

This file owns the entire selected environment. Omitting a resource can delete
it. Use a new dedicated project; importing an existing environment is separate
work and must preserve all intended resources. Switching an existing project to
desktop-only can remove its web service. The wrapper never passes
`--confirm-destructive`, prints/decrypts provider variable values, or retries a
failed command by creating a replacement project.

## Commands and future live workflow

These first commands use local state only:

```sh
npm run cloud -- inspect
npm run cloud:typecheck
npm run cloud -- context
```

`inspect` evaluates the native definition without fetching Railway state. It is
not a provider plan. `context` creates an upload snapshot under
`target/cloud-context/`, copies only allowlisted Git-visible source files,
rejects symlinks and excludes credentials, local environment files, generated
outputs, unrelated documents and caches. Its manifest records source hashes.
Both the normal repository and filtered snapshot have built the production web
image locally.

After a future live deployment request, the operator workflow is:

1. Edit and review `.railway/hearth.json`, including the website choice.
2. Run `npm run cloud -- tools` to install/verify the pinned local CLI, then
   `npm run cloud -- login` if authentication is needed.
3. Create a fresh project with `npm run cloud -- init --workspace <workspace>`
   or select one with `npm run cloud -- link --project <project-id>`.
4. Run `npm run cloud -- plan` and review the actual provider changes. Its default
   output redacts variable values. Plans must not be committed with secret values.
5. Run `npm run cloud -- deploy`. Native IaC previews and confirms its current
   changes, then the wrapper reuses existing domains or assigns missing domains
   targeting port 8080, uploads the filtered source snapshot, and waits for the
   exact uploaded deployment IDs to pass their build/runtime checks.
6. Run `npm run cloud -- status` to check HTTPS health, discovery and website/proxy
   identity. Complete owner enrollment and the storage/network acceptance below.

The command will not select a different project just because a command failed.
It requires the linked project name and intended environment to match the
reviewed settings. Native IaC application and `up --detach` alone are not a
successful deployment. Build/runtime failure, a missing uploaded deployment ID,
a mismatched proxy identity or an existing domain on a different port fails the
check. Public reads omit credentials and reject redirects. Provider failures
refer the operator to authenticated Railway diagnostics without copying logs or
variables into source or the summary.

Generated domains use a bounded CLI bootstrap because they are outside the native
declaration. Custom-domain DNS/certificate setup and protected cloud owner-code
handoff are still open. The existing operator-only `hearth-server --setup-code`
can be run through authenticated provider access as a manual fallback; enter it
only in the client owner-setup field. Never put it in a URL or deployment log.
The client creates the password, device keys and recovery kit.

## Production browser image

Build from the repository root:

```sh
docker build -f crates/hearth-server/Dockerfile -t hearth-server:local .
docker build -f deploy/web/Dockerfile -t hearth-web:local .
```

Rust, Node, Debian, Caddy and provider PostgreSQL images are pinned by digest.
The Rust build also selects toolchain 1.99.1 explicitly, avoiding a mutable
`stable` override from `rust-toolchain.toml` during container builds. The web build
compiles the current crypto crate to WASM, installs the matching lockfile version
of wasm-bindgen, and bundles that exact output with React. It serves static files
through Caddy; no Vite development server or provider secrets enter the runtime.

At runtime set `HEARTH_BACKEND_UPSTREAM` to a trusted private backend host/port,
such as `hearth.railway.internal:8080`, and `PORT` to the provider listener port.
The website proxies discovery, REST and gateway WebSockets through its own
origin. Native IaC references the backend private domain and configures exact
browser/Tauri origins on the backend. Desktop users can use the separate public
backend domain without deploying a website.

The web server runs unprivileged and permits only local scripts/workers, with WASM execution enabled;
remote server and attachment connections use HTTPS/WSS. It sets no-referrer,
nosniff, frame protection and same-origin capture permissions, and strips cookies
from upstream requests. HTML, push-worker and SPA navigation are not cached;
hashed assets are immutable. Missing asset/API paths return errors rather than
the SPA document. An old tab needing a removed build asset may need a reload;
it must not receive HTML in place of its crypto module. No access log records
lease URLs. Per-request proxy error logs are also disabled because they can
include the request URI and authorization metadata. Startup diagnostics remain
available; backend runtime logging remains content-free.

A website host capable of replacing delivered JavaScript can affect client-side
encryption. Desktop binaries have a separate signing/update trust boundary.
Neither hosting option moves normal search, previews or media keys to the server.

## Persistence and remaining acceptance

The server image handles a root-owned mounted data directory, protects known key
files with mode 0600, then starts Hearth under its unprivileged account. It does
not recursively change unrelated files. Existing database accounts without the
matching server signing/OPAQUE files fail closed. Local image tests cover these
checks and identity/session persistence through restart.

The [hosted recovery procedure](CLOUD_RECOVERY.md) covers coordinated backups,
fresh-resource restore, verified updates and rollback. Scheduled Railway backup
jobs and real-provider restore remain held with provisioning. A usable restore
must coordinate PostgreSQL, matching server data and encrypted objects from the
same deployment, preserve the advertised identity, use private backup storage,
and restore into fresh resources before changing traffic. Database backups do
not replace server keys, encrypted objects or users' recovery kits/history.
Do not treat provider snapshots or redeploy success as this acceptance result.

Before any cloud slice is accepted, test bucket CORS with the exact website
origins, signed 50 MB encrypted transfers, browser and desktop users on separate
networks, permission/deletion/retention paths, retry without duplicate resources,
and fresh restore. The command reports storage and media as unvalidated even
when health/discovery/web checks pass. TURN/SFU public UDP connectivity requires
its own deployment and network tests.

Local verification:

```sh
npm run verify
npm run cloud:typecheck
npm run test:cloud-images
npm run test:storage
```

`test:cloud-images` uses disposable Linux containers, networks and volumes plus
headless Chromium. It checks production headers/assets/WASM/worker behavior,
OPAQUE owner registration/login, device enrollment, gateway upgrade, private keys,
restart, fresh database/key-volume restore and missing-key failure. The restore
fixture copies backup bytes in memory and clears them; encrypted-object/cloud
restore is still separate. Its report is under
`target/cloud-images-evidence/`; no real accounts or operator deployments are used.
The dated [local acceptance record](evidence/phase4-cloud-local-2026-10-20.json)
preserves source hashes, image checks and the remaining provider/media boundaries.

Provider references rechecked 2026-10-20:
[native IaC](https://docs.railway.com/infrastructure-as-code),
[SDK reference](https://docs.railway.com/infrastructure-as-code/reference),
[config command](https://docs.railway.com/cli/config),
[CLI 5.71.0 release](https://github.com/railwayapp/cli/releases/tag/v5.71.0),
[private networking](https://docs.railway.com/networking/private-networking/how-it-works).
