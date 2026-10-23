# Hosted backup, update and recovery

Railway remains paused. This procedure is prepared for an operator-controlled
deployment; it does not authorize provisioning, scheduled paid jobs or production
traffic changes. The local Docker image fixture rehearses a fresh PostgreSQL and
server-key-volume restore. Real-provider bucket export/restore and a complete
fresh hosted deployment still require separate acceptance.

Keep a recovery set for one deployment and one quiesced checkpoint together:

- A PostgreSQL custom-format dump, including migrations and ciphertext metadata.
- The matching entire server data volume, including signing and OPAQUE setup files.
- A private copy of encrypted objects and an object-key/length/SHA-256 inventory.
- Protected deployment settings: bucket/region/style, exact web origins and
  advertised server address, plus SFU/TURN settings and routing credentials if used.
- The verified release version, image digest, source revision, public server
  fingerprint, backup time and SHA-256 inventory of every backup component.

Treat the entire set as secret, including database credentials and provider
credentials. Store it in access-controlled encrypted storage separate from the
running deployment; keep the decryption/recovery credential separately. Do not
put backups, credential exports or inventories in source control, public buckets,
release assets, issue attachments or ordinary logs. Server backups do not replace
users' recovery kits and encrypted local history.

## Take a consistent backup

1. Record the public identity and current release without exporting secrets into
   ordinary diagnostics. Plan a maintenance interval and prevent new writes.
2. Stop the Hearth application and website services. Keep the private database
   available only to the backup operation; leave no alternate writable backend.
   Wait for in-flight uploads/transactions to finish before taking the checkpoint.
3. Export PostgreSQL, snapshot the matching server data volume, and copy the
   encrypted bucket objects. Do not regenerate missing authentication keys.
4. Inventory object keys, lengths and hashes and compare them with the encrypted
   object records at the checkpoint. Include still-retained objects; apply the
   existing deletion/retention policy to backup expiration as well as live data.
5. Hash the completed artifacts, protect the inventory with the backup set and
   rehearse the restore below before treating the backup as usable.
6. Restart the original deployment if remaining on it. Confirm the same public
   fingerprint, existing-account login and encrypted attachment retrieval.

Provider snapshots taken at different times are not a coordinated recovery set.
A database-only backup cannot recover existing passwords without its matching
OPAQUE files or retrieve files whose encrypted objects are missing.

## Restore into fresh resources

1. Keep the original deployment intact and offline during cutover. Create fresh
   private database, server-volume and bucket resources with separate credentials;
   do not restore over an unrelated existing server.
2. Verify every backup hash before writing. Restore PostgreSQL and the complete
   matching key volume, retaining the server files' restricted permissions.
3. Restore ciphertext objects without changing their object keys or bytes.
   Verify every restored length/hash and the inventory against database records.
4. Configure the restored backend for the new private database/bucket resources
   and its original public identity. Rewire infrastructure references rather than
   reusing credentials from the old resources. Start the verified compatible
   image against a temporary test address with exact allowed website origins.
5. Compare the public signing fingerprint with the recorded original. Existing
   setup must already be complete. A missing-key startup refusal is a recovery
   failure to investigate; creating a fresh owner or replacement keys is not a fix.
6. Verify an existing account can log in, an approved client can decrypt prior
   messages and files, and new ciphertext transfers survive a restart. Check
   deletion/retention and both desktop/browser paths before changing traffic.
7. Test media routing separately. Matching SFU credentials and successful HTTPS
   health do not establish public UDP, WSS, TURN-TLS or outside-network access.
8. Change traffic only after acceptance. Retain the original protected recovery
   set and document which deployment is authoritative. Never allow both restored
   copies to accept writes under the same advertised identity.

## Updates and rollback

Verify release catalog signatures, version compatibility, source revision and
image digest before stopping services. Keep the previous image and a rehearsed
coordinated backup. Apply migrations with the compatible new server, then verify
identity, existing login and encrypted objects before reopening traffic.

If startup or acceptance fails before new writes, restore the complete checkpoint
into fresh resources and use its matching previous image. Do not assume an older
binary can read a newer schema. If new writes have occurred, stop writes and
preserve that state before choosing recovery; blindly restoring the old checkpoint
would discard those writes. Client-only call keys are never backed up by the
server; participants must rejoin with fresh authorization after recovery.

Scheduled backup jobs must use least-privilege access, private destinations,
bounded retention and failure notifications. Scheduling against Railway is held
with live provisioning. A provider's successful snapshot status is not evidence
of a successful fresh restore.
