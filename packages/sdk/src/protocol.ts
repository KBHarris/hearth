// Generated from hearth-proto. Do not edit by hand.
// Regenerate: npm run protocol:generate
// SPDX-License-Identifier: Apache-2.0 OR MIT

export const PROTOCOL_VERSION = 1 as const

export type CreateCommunity = { name: string, };

export type Community = { id: string, name: string, owner_id: string, };

export type Category = { id: string, community_id: string, name: string, };

export type ChannelKind = "text" | "announcement";

export type CreateChannel = { name: string, category_id: string | null, kind: ChannelKind, };

export type Channel = { id: string, community_id: string, name: string, category_id: string | null, kind: ChannelKind, };

export type CommunityStructure = { community: Community, categories: Array<Category>, channels: Array<Channel>, };

export type CreateCommunityInvite = { expires_in_seconds: number, max_uses: number, };

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

export type Conversation = { id: string, accounts: Array<string>, epoch: number, members: Array<GroupMember>, };

export type WelcomeEnvelope = { device_key: string, package_hash: string, ciphertext: string, };

export type CommitUpload = { operation_id: string, device_key: string, expected_epoch: number, members: Array<GroupMember>, commit: string, welcomes: Array<WelcomeEnvelope>, signature: string, };

export type MessageAction = "send" | "edit" | "delete" | "typing";

export type MessageUpload = { operation_id: string, device_key: string, epoch: number, action: MessageAction, target_id: string | null, ciphertext: string, signature: string, };

export type DeliveryData = { "kind": "commit", upload: CommitUpload, } | { "kind": "welcome", upload: CommitUpload, welcome: WelcomeEnvelope, } | { "kind": "message", upload: MessageUpload, } | { "kind": "redacted" };

export type DeliveryEvent = { seq: number, conversation_id: string, data: DeliveryData, };

export type MessageContent = { "kind": "text", text: string, reply_to: string | null, } | { "kind": "edit", id: string, text: string, } | { "kind": "delete", id: string, } | { "kind": "typing", active: boolean, };

export type LocalMessage = { id: string, conversation_id: string, author_id: string, text: string, reply_to: string | null, edited: boolean, deleted: boolean, };

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
