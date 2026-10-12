# Phase 3 permission acceptance matrix

The checked-in inventory in `scripts/phase3-endpoint-matrix.mjs` covers every REST method registered by the current server. The gateway has four client operations. Discovery and authentication exchanges are public; all other initial requests require a live account session. Exact signed deletion retries are deliberately idempotent after session revocation.

`verify-auth.mjs --phase3` records only normalized routes and HTTP status codes in `target/phase3-evidence/http-endpoint-outcomes.json`. Every listed method needs a successful fixture. Every private method also needs an access rejection. Successful authenticated requests are replayed without a token using the same valid body, so a JSON parsing error cannot stand in for an authorization check. Storage routes require `--storage` and a real private S3 fixture.

## Role and proof boundaries

| Surface | Required authority | Additional acceptance cases |
| --- | --- | --- |
| Server settings, account invitations and bans | Server operator | Ordinary account denied; ban revokes sessions, login and gateway; restart preserves ban |
| Account identity, linking, blocks, export and push | Own live session and applicable approved device proof | Wrong account/device denied; blocks remain private; encrypted export excludes credentials; push key and endpoint validation |
| Account deletion | Own session and signed approved-device departure | Wrong proof/account denied; operator and community owner protected; concurrent identical retry; revoked credentials; late credential writes fenced; restart retry |
| Community structure and invitation | Community member | Nonmember and unrelated operator denied |
| Categories, channels, authority, admissions, policies and invites | Community owner with signed authority where applicable | Nonowner denied; signature tamper/CAS conflict; immutable history boundary; expiry and competing invite uses |
| Governance | Owner, or signed restricted moderator delegation | Moderator cannot change roles, rules or retention or target owner/peer; stale/forged proof rejected |
| Audit | Owner or AUDIT grant | Nonmember/ordinary member denied; log excludes plaintext |
| Rules acceptance | Current member and exact current rule digest | Changed rules invalidate consent; read remains available; posting requires fresh consent |
| Ownership | Current owner offers, selected approved successor accepts | Two signatures, exact endorsed snapshot, pinned lineage; unrelated member denied; cancellation and retry; old unused invites invalidated |
| Packages and directory | Live session, approved device for publishing | Wrong device/session binding and signature denied |
| Conversations, history and queued events | Approved device and conversation audience/READ | Nonmember and wrong device denied; READ revocation filters history/backlog/blob access |
| Commits and messages | Approved sender, signed envelope, audience and exact epoch | CAS race/retry, tamper, timeout, SEND/REACT/PIN/ATTACH, screening, slow mode; prune before publishing to revoked members |
| Report keys and queue | Current MODERATE scope and approved device | Ordinary member denied; own recipient queue only; signed key bound to channel |
| Report submission | Current READ member, selected signed evidence and authorized recipient | Unauthenticated, mismatched reporter and scope denied; bounded ciphertext; sender-proof verification; no unselected text |
| Blob reserve/complete/download | Approved device, audience and ATTACH/READ as applicable | Wrong member, revoked READ, retention expiry and account departure deny; private physical S3 deletion |

## Gateway operations

| Operation | Valid fixture | Rejection fixtures |
| --- | --- | --- |
| Identify | Session plus device signature over server challenge | Forged signature, wrong device/token pair, duplicate identification; banned/deleted account |
| Resume | Identified connection, same connection session, retained cursor | Before identification, wrong session, future cursor, duplicate resume |
| Ack | Resumed connection, monotonic cursor no higher than sent | Before identification, before resume, future cursor |
| Heartbeat | Identified connection and valid optional cursor | Before identification, future cursor; revoked sessions stop delivery |

Live gateway read filtering and REST backlog filtering use the same current audience/permission rules. The product crypto worker verifies each ordered envelope before sealing its cursor and acknowledging receipt. A denied reader is removed from the MLS audience before new publishing; old downloaded copies remain on recipients' devices.

## Complete REST inventory

```
GET /.well-known/hearth
GET /api/v1/auth/account/export
GET /api/v1/auth/admin/bans
GET /api/v1/auth/admin/settings
GET /api/v1/auth/blocks
GET /api/v1/auth/device/link/{id}
GET /api/v1/auth/identity
GET /api/v1/auth/push
GET /api/v1/auth/registration
GET /api/v1/auth/session
GET /api/v1/blobs/{id}/{id}
GET /api/v1/chat/accounts/{id}
GET /api/v1/chat/conversations
GET /api/v1/chat/conversations/{id}/history
GET /api/v1/chat/events/{id}
GET /api/v1/chat/packages/{id}
GET /api/v1/chat/people/{username}
GET /api/v1/communities
GET /api/v1/communities/channels/{id}/report-keys
GET /api/v1/communities/channels/{id}/reports
GET /api/v1/communities/channels/{id}/roster
GET /api/v1/communities/{id}
GET /api/v1/communities/{id}/audit
GET /api/v1/communities/{id}/governance
GET /api/v1/communities/{id}/invitation
GET /api/v1/communities/{id}/ownership
GET /api/v1/setup
GET /health
POST /api/v1/auth/account/delete
POST /api/v1/auth/admin/bans
POST /api/v1/auth/admin/invite
POST /api/v1/auth/admin/settings
POST /api/v1/auth/blocks
POST /api/v1/auth/device/first
POST /api/v1/auth/device/link
POST /api/v1/auth/device/restore
POST /api/v1/auth/login/finish
POST /api/v1/auth/login/start
POST /api/v1/auth/logout
POST /api/v1/auth/owner/finish
POST /api/v1/auth/owner/start
POST /api/v1/auth/push
POST /api/v1/auth/push/disable
POST /api/v1/auth/register/finish
POST /api/v1/auth/register/start
POST /api/v1/blobs/{id}
POST /api/v1/blobs/{id}/{id}/complete
POST /api/v1/chat/conversations/{id}/commit
POST /api/v1/chat/conversations/{id}/message
POST /api/v1/chat/packages
POST /api/v1/chat/packages/claim
POST /api/v1/communities
POST /api/v1/communities/channels/{id}/policy
POST /api/v1/communities/channels/{id}/report-keys
POST /api/v1/communities/channels/{id}/reports
POST /api/v1/communities/channels/{id}/reports/{id}/resolve
POST /api/v1/communities/join
POST /api/v1/communities/{id}/admissions
POST /api/v1/communities/{id}/authority
POST /api/v1/communities/{id}/categories
POST /api/v1/communities/{id}/channels
POST /api/v1/communities/{id}/governance
POST /api/v1/communities/{id}/invites
POST /api/v1/communities/{id}/ownership
POST /api/v1/communities/{id}/ownership/accept
POST /api/v1/communities/{id}/ownership/cancel
POST /api/v1/communities/{id}/rules/accept
```

Run the real HTTP/WASM fixture, two-client browser workflow, and packaged Phase 3 jobs before marking the roadmap exit gate complete. Native unit checks alone do not validate a packaged client or physical S3 deletion.
