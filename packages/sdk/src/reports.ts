import type {ReportKey,ReportEnvelope,QueuedReport} from './protocol.ts'
import {isMember} from './index.ts'
const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v)
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const sig=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{128}$/.test(v)
export function isReportKey(v:unknown):v is ReportKey{return record(v)&&id(v.community_id)&&isMember(v.member)&&id(v.public_key)&&sig(v.signature)}
export function isReportKeys(v:unknown):v is ReportKey[]{return Array.isArray(v)&&v.length<=128&&v.every(isReportKey)}
export function isReportEnvelope(v:unknown):v is ReportEnvelope{return record(v)&&id(v.id)&&id(v.channel_id)&&isMember(v.reporter)&&isReportKey(v.recipient)&&id(v.ephemeral)&&sig(v.signature)&&typeof v.ciphertext==='string'&&v.ciphertext.length>=80&&v.ciphertext.length<=256*1024&&/^[a-f0-9]+$/.test(v.ciphertext)}
export function isReportQueue(v:unknown):v is QueuedReport[]{return Array.isArray(v)&&v.length<=100&&v.every(r=>record(r)&&typeof r.resolved==='boolean'&&isReportEnvelope(r.envelope))}
