// Generated from hearth-proto. Do not edit by hand.
// Regenerate: npm run protocol:generate
// SPDX-License-Identifier: Apache-2.0 OR MIT

export const PROTOCOL_VERSION = 1 as const

export type ScheduledEvent = { title: string, description: string, starts_at: number, ends_at: number, location: string, };

export type Rsvp = "going" | "interested" | "declined";

export type PlaybackProvider = "youtube" | "spotify" | "soundcloud";

export type PlaybackPosition = { revision: number, playing: boolean, position_ms: number, sent_at: number, };

export type SharedPlayback = { title: string, provider: PlaybackProvider, url: string, position: PlaybackPosition, };

export type Activity = { "type": "event", event: ScheduledEvent, } | { "type": "event_cancel", id: string, } | { "type": "rsvp", id: string, response: Rsvp, } | { "type": "playback", playback: SharedPlayback, } | { "type": "playback_update", id: string, position: PlaybackPosition, };

export type LocalEvent = { event: ScheduledEvent, cancelled: boolean, rsvps: { [key in string]: Rsvp }, };

export type VoicePresence = { channel_id: string, room_id: string, epoch: number, device_key: string, incarnation: string,
/**
 * Public P-256 contribution, never an exporter, shared secret or frame key.
 */
public_key: string, relay_only: boolean,
/**
 * True binds the SFU topology. Absent retains the original mesh transcript.
 */
sfu?: boolean, active: boolean, issued_at: number, expires_at: number, signature: string, };

export type VoiceRoom = { channel_id: string, room_id: string, epoch: number, revision: number, relay_only: boolean, sfu?: boolean, capacity: number, participants: Array<VoicePresence>, };

export type SfuAccess = {
/**
 * Optional same-machine signaling endpoint. Clients use it only when their
 * authenticated Hearth API itself is on loopback, never for remote servers.
 */
local_url?: string, channel_id: string, room_id: string, revision: number, url: string, room: string, identity: string, token: string, expires_at: number, };

export type WrappedMediaKey = { recipient: string, nonce: string, ciphertext: string, };

export type InviteEnvelope = { nonce: string, ciphertext: string, };

export type StoreInviteEnvelope = { id: string, envelope: InviteEnvelope, };

export type AccountDeparture = { member: GroupMember, operation_id: string, signature: string, };

export type ExportRecord = { cursor: string, data: unknown, };

export type AccountExport = { account: Account, devices: Array<DeviceEnrollment>, communities: Array<Community>, blocks: Array<Account>, records: Array<ExportRecord>, next: string | null, };

export type SenderProof = { server: string, channel_id: string, operation_id: string, epoch: number, member: GroupMember, content: MessageContent, signature: string, };

export type ReportKey = { community_id: string, member: GroupMember, public_key: string, signature: string, };

export type ReportEvidence = { reason: string, selected: Array<SenderProof>, };

export type ReportEnvelope = { id: string, channel_id: string, reporter: GroupMember, recipient: ReportKey, ephemeral: string, ciphertext: string, signature: string, };

export type QueuedReport = { envelope: ReportEnvelope, resolved: boolean, };

export type Role = { id: string, name: string, permissions: number, };

export type RoleAssignment = { account_id: string, role_ids: Array<string>, };

export type OverrideKind = "everyone" | "role" | "member";

export type PermissionOverride = { channel_id: string, kind: OverrideKind, target_id: string, allow: number, deny: number, };

export type SanctionKind = "ban" | "kick" | "timeout";

export type Sanction = { account_id: string, channel_id: string | null, kind: SanctionKind, until: number | null,
/**
 * Kicks deny every admission tied to an invitation issued at or before this cutoff.
 */
kick_after?: number, };

export type ChannelLimits = { channel_id: string, slowmode_seconds: number, retention_days: number | null, };

export type Governance = {
/**
 * Explicit media bits. Absence preserves the signed pre-media policy.
 */
media_version?: number, community_id: string, revision: number, everyone: number, roles: Array<Role>, assignments: Array<RoleAssignment>, overrides: Array<PermissionOverride>, sanctions: Array<Sanction>, limits: Array<ChannelLimits>, rules: string, screening: boolean, owner: GroupMember, signature: string,
/**
 * A delegated moderator signs a restricted successor of this verified policy.
 */
delegation?: Governance, moderator_admission?: CommunityAdmission, };

export type GovernanceView = { admission?: CommunityAdmission, governance: Governance | null, members: Array<Account>, rules_accepted: boolean, };

export type RulesAcceptance = { digest: string, };

export type AuditEntry = { revision: number, actor_id: string, action: string, digest: string, };

export type CreateCommunity = { name: string, };

export type Community = { id: string, name: string, owner_id: string, };

export type Category = { id: string, community_id: string, name: string, };

export type ChannelKind = "text" | "announcement" | "forum" | "voice" | "stage";

export type CreateChannel = { name: string, category_id: string | null, kind: ChannelKind, };

export type Channel = { id: string, community_id: string, name: string, category_id: string | null, kind: ChannelKind, };

export type ChannelRoster = { community: Community, channel: Channel, people: Array<Person>, authority: CommunityAuthority | null, policy: ChannelPolicy | null, admissions: Array<CommunityAdmission>, departures?: Array<AccountDeparture>, invitations: Array<MemberInvitation>, governance?: Governance, rules_accepted?: boolean, };

export type CommunityAuthority = { community_id: string, owner: GroupMember, signature: string, handoff?: OwnershipHandoff, };

export type OwnershipHandoff = { previous: CommunityAuthority, issuer: GroupMember, successor: GroupMember, endorsed: Array<string>, signature: string, };

export type OwnershipAcceptance = { authority: CommunityAuthority, former_owner: CommunityAdmission, governance: Governance, };

export type OwnershipState = { authority: CommunityAuthority, endorsed: Array<string>, offer: OwnershipHandoff | null, };

export type CommunityAdmission = { community_id: string, account_id: string, identity_key: string, owner: GroupMember, history_from: Record<string, number>, signature: string, invitation?: CommunityInvitation, };

export type CommunityInvitation = { community_id: string, invite_id: string, owner: GroupMember, history_from: Record<string, number>, issued_at: number, signature: string, };

export type MemberInvitation = { account_id: string, invitation: CommunityInvitation, };

export type HistoryPolicy = "none" | "since_invite" | "full";

export type ChannelPolicy = { channel_id: string, community_id: string, kind: ChannelKind, history: HistoryPolicy, revision: number, created_at: number, history_open_for: Array<string>, owner: GroupMember, signature: string, };

export type ChannelAuthorization = { authority: CommunityAuthority, policy: ChannelPolicy, admissions: Array<CommunityAdmission>, departures?: Array<AccountDeparture>, governance?: Governance, };

export type CommunityStructure = { community: Community, categories: Array<Category>, channels: Array<Channel>, authority: CommunityAuthority | null, };

export type CreateCommunityInvite = { expires_in_seconds: number, max_uses: number, code?: string, authorization?: CommunityInvitation, };

export type CommunityInvite = { code: string, expires_in_seconds: number, max_uses: number, };

export type JoinCommunity = { code: string, };

export type OwnerRegistrationStart = { username: string, message: string, setup_code: string, };

export type OwnerRegistrationFinish = { username: string, message: string, setup_code: string, };

export type LoginStart = { username: string, message: string, };

export type LoginFinish = { exchange_id: string, message: string, };

export type AuthResponse = { message: string, profile: string, };

export type LoginResponse = { message: string, profile: string, exchange_id: string, };

export type Account = { id: string, username: string, owner: boolean, };

export type Session = { token: string, expires_in_seconds: number, account: Account, };

export type RegistrationMode = "closed" | "invite" | "open";

export type RegistrationStatus = { registration_mode: RegistrationMode, };

export type RegistrationStart = { username: string, message: string, invite_code: string | null, };

export type RegistrationFinish = { username: string, message: string, invite_code: string | null, };

export type ServerSettings = { server_name: string, registration_mode: RegistrationMode, };

export type AccountInvite = { code: string, expires_in_seconds: number, };

export type DeviceEnrollment = { identity_key: string, device_key: string, certificate: string, account_signature: string, device_signature: string, };

export type AccountIdentity = { identity_key: string | null, devices: Array<DeviceEnrollment>, };

export type DeviceRestore = { enrollment: DeviceEnrollment, link_id: string | null, };

export type DeviceLinkOffer = { id: string, device_key: string, envelope: string, signature: string, };

export type DeviceLinkEnvelope = { envelope: string, expires_in_seconds: number, };

export type GroupMember = { account_id: string, enrollment: DeviceEnrollment, };

export type KeyPackageRecord = { member: GroupMember, package: string, package_hash: string, };

export type PackageClaim = { device_keys: Array<string>, };

export type Person = { account: Account, devices: Array<DeviceEnrollment>, };

export type Conversation = { id: string, channel_id: string | null, accounts: Array<string>, epoch: number, members: Array<GroupMember>, };

export type WelcomeEnvelope = { device_key: string, package_hash: string, ciphertext: string, };

export type CommitUpload = { operation_id: string, device_key: string, expected_epoch: number, members: Array<GroupMember>, commit: string, welcomes: Array<WelcomeEnvelope>, signature: string, authorization?: ChannelAuthorization, };

export type MessageAction = "send" | "edit" | "delete" | "typing" | "reaction" | "pin" | "control";

export type MessageUpload = { operation_id: string, device_key: string, epoch: number, action: MessageAction, target_id: string | null, ciphertext: string, signature: string, archive?: HistoryArchive, };

export type HistoryArchive = { member: GroupMember, ciphertext: string, };

export type HistoryPage = { items: Array<MessageUpload>, next: number, };

export type DeliveryData = { "kind": "commit", upload: CommitUpload, } | { "kind": "welcome", upload: CommitUpload, welcome: WelcomeEnvelope, } | { "kind": "message", upload: MessageUpload, } | { "kind": "redacted" };

export type DeliveryEvent = { seq: number, conversation_id: string, data: DeliveryData, };

export type MessageContent = { "kind": "activity", activity: Activity, } | { "kind": "call", signal: CallSignal, } | { "kind": "forum_post", title: string, text: string, } | { "kind": "poll", question: string, options: Array<string>, multiple: boolean, parent: string | null, } | { "kind": "poll_vote", id: string, choices: Array<number>, } | { "kind": "poll_close", id: string, } | { "kind": "attachment", text: string, files: Array<EncryptedAttachment>, } | { "kind": "emoji", alias: string, asset: EncryptedAttachment, } | { "kind": "history_request", request_id: string, device_key: string, public_key: string, } | { "kind": "history_share", request_id: string, device_key: string, public_key: string, ciphertext: string, } | { "kind": "text", text: string, reply_to: string | null, } | { "kind": "edit", id: string, text: string, } | { "kind": "delete", id: string, } | { "kind": "typing", active: boolean, } | { "kind": "thread", text: string, parent: string, } | { "kind": "reaction", id: string, emoji: string, active: boolean, } | { "kind": "pin", id: string, active: boolean, } | { "kind": "read", id: string, } | { "kind": "profile", display_name: string, bio: string, } | { "kind": "presence", state: string, until: number, } | { "kind": "rich_text", text: string, reply_to: string | null, embed: LinkEmbed, };

export type CallSignal = { call_id: string, epoch: number, from_device: string, to_device: string, expires_at: number, kind: string, description: string | null, relay_only: boolean,
/**
 * Private three-account admission context; absent for the existing 1:1 format.
 */
group_id?: string,
/**
 * Exactly three sorted device keys, one per account. Client-only MLS content.
 */
participants?: Array<string>,
/**
 * Persistent community voice room generation; absent for private calls.
 */
voice_room?: string, };

export type LocalCallSignal = { conversation_id: string, account_id: string, signal: CallSignal, };

export type IceServer = { urls: Array<string>, username: string | null, credential: string | null, };

export type IceConfiguration = { ice_servers: Array<IceServer>, expires_at: number, };

export type LocalMessage = { event?: LocalEvent, playback?: SharedPlayback, id: string, conversation_id: string, author_id: string, text: string, reply_to: string | null, edited: boolean, deleted: boolean, thread: string | null, reactions: { [key in string]: Array<string> }, pinned: boolean, embed: LinkEmbed | null, attachments: Array<LocalAttachment>, topic: string | null, poll: LocalPoll | null, };

export type LocalPoll = { options: Array<string>, multiple: boolean, closed: boolean, votes: { [key in string]: Array<number> }, };

export type LocalProfile = { display_name: string, bio: string, };

export type LocalPresence = { state: string, until: number, };

export type LinkEmbed = { url: string, title: string, description: string, };

export type EncryptedAttachment = { file: LocalAttachment, key: string, nonce: string, thumbnail: EncryptedAttachment | null, };

export type LocalAttachment = { id: string, name: string, mime: string, bytes: number, cipher_bytes: number, digest: string, thumbnail: LocalAttachment | null, };

export type BlobReservation = { id: string, device_key: string, cipher_bytes: number, digest: string, };

export type BlobUrl = { url: string, expires_in_seconds: number, };

export type HealthStatus = "ok" | "degraded";

export type Health = { status: HealthStatus, version: string, protocol: number, };

export type WellKnown = {
/**
 * Public domain of this server.
 */
server_name: string,
/**
 * Supported protocol versions, newest first.
 */
protocols: Array<number>,
/**
 * Hex-encoded Ed25519 server signing key.
 */
server_key: string,
/**
 * Whether this server accepts federation traffic at all.
 */
federation: boolean, };

export type SetupStatus = { setup_complete: boolean, };

export type ClientFrame = { "op": "identify", "d": { protocol: number, token: string, device_key: string, signature: string, } } | { "op": "heartbeat", "d": { last_seq: number | null, } } | { "op": "ack", "d": { last_seq: number, } } | { "op": "resume", "d": { session_id: string, last_seq: number, } };

export type ServerFrame = { "op": "challenge", "d": { challenge: string, } } | { "op": "hello", "d": { protocol: number, heartbeat_interval_ms: number, } } | { "op": "heartbeat_ack" } | { "op": "ready", "d": { session_id: string, } } | { "op": "event", "d": { seq: number, event: unknown, } } | { "op": "invalid_session", "d": { reason: string, } };
