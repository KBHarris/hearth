// Mirrors crates/hearth-proto. Phase 0 replaces this hand-written file with types
// generated from the Rust definitions so the two can never drift.

export const PROTOCOL_VERSION = 1

export interface Health {
  status: 'ok' | 'degraded'
  version: string
  protocol: number
}

export interface WellKnown {
  server_name: string
  protocols: number[]
  server_key: string
  federation: boolean
}

export type ClientFrame =
  | { op: 'identify'; d: { protocol: number; token: string } }
  | { op: 'heartbeat'; d: { last_seq: number | null } }
  | { op: 'resume'; d: { session_id: string; last_seq: number } }

export type ServerFrame =
  | { op: 'hello'; d: { protocol: number; heartbeat_interval_ms: number } }
  | { op: 'heartbeat_ack' }
  | { op: 'ready'; d: { session_id: string } }
  | { op: 'event'; d: { seq: number; event: unknown } }
  | { op: 'invalid_session'; d: { reason: string } }
