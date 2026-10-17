# ADR 0016: Signed account departure and retained public proofs

Date: 2026-10-12. Status: implemented; final cross-platform acceptance pending.

An approved device signs a server-scoped account-departure nonce. The client seals
this retry proof before making the deletion request. Initial deletion additionally
requires the account session. An exact signed retry returns success after sessions
have been revoked, including after restart. It cannot delete another account.
The operator account cannot be erased; community owners must transfer ownership.

Deletion locks the account, removes its password record, pending login exchanges,
sessions, link offers, KeyPackages, issued account invites, private blocks, push
subscriptions, moderator keys and reports addressed to or submitted by it. Its
own authored message archives and queued application ciphertext are removed or
redacted. Other authors' records remain. The username becomes a generated tombstone.

Public account/device certificates, community admissions, signed governance and
ownership history, operation retry digests, cursor continuity and other recipients'
MLS Welcome/commit material remain so existing transcripts can still be verified.
Retained metadata is not a complete anonymization promise. Public proofs do not
retain passwords, private identity keys or message plaintext.

Account foreign-key writes hold a shared live-account lock. Deletion takes the
exclusive lock; a late write observes the tombstone and fails. Publishing checks
and locks the proposed/current audience too. Deleted devices cannot be restored,
re-enrolled, subscribed, included in a new commit or kept in a publishing audience.
A signed departure travels in channel authorization. Clients pin it monotonically,
remove the device from MLS, and rotate before publishing again. Existing immutable
DM audiences require a new conversation without the departed participant.

Owned blobs become unavailable through Hearth immediately. Physical object cleanup
waits twenty minutes to outlast previously issued upload leases, deletes the private
S3 object first and then its database index. Failed object deletion remains retryable.
Previously issued download URLs, received copies, local vaults/history, storage
versions and backups cannot be recalled by this endpoint. No local-key wipe is
implied. Account export and recovery kits are separate user actions.

The prototype authorization/roster bounds include retained departure records;
long-lived communities with heavy churn need compaction before production scale.
Fixtures test only disposable accounts and databases. Storage acceptance advances
fixture timestamps with a transaction-local database replication setting solely
to exercise the lease-expiry cleanup without a twenty-minute wall-clock wait.
