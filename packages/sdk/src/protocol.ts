// Generated from hearth-proto. Do not edit by hand.
// Regenerate: npm run protocol:generate
// SPDX-License-Identifier: Apache-2.0 OR MIT

export const PROTOCOL_VERSION = 1 as const

export type OwnerRegistrationStart = { username: string, message: string, setup_code: string, };

export type OwnerRegistrationFinish = { username: string, message: string, setup_code: string, };

export type LoginStart = { username: string, message: string, };

export type LoginFinish = { exchange_id: string, message: string, };

export type AuthResponse = { message: string, profile: string, };

export type LoginResponse = { message: string, profile: string, exchange_id: string, };

export type Account = { id: string, username: string, owner: boolean, };

export type Session = { token: string, expires_in_seconds: number, account: Account, };

export type DeviceEnrollment = { identity_key: string, device_key: string, certificate: string, account_signature: string, device_signature: string, };

export type AccountIdentity = { identity_key: string | null, devices: Array<DeviceEnrollment>, };

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

export type ClientFrame = { "op": "identify", "d": { protocol: number, token: string, } } | { "op": "heartbeat", "d": { last_seq: number | null, } } | { "op": "resume", "d": { session_id: string, last_seq: number, } };

export type ServerFrame = { "op": "hello", "d": { protocol: number, heartbeat_interval_ms: number, } } | { "op": "heartbeat_ack" } | { "op": "ready", "d": { session_id: string, } } | { "op": "event", "d": { seq: number, event: unknown, } } | { "op": "invalid_session", "d": { reason: string, } };
