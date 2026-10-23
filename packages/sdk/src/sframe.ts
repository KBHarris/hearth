// RFC 9605 AES_128_GCM_SHA256_128 (suite 0x0004). No platform/application I/O.
const bytes = (value: bigint) => {
  if (value < 0n || value > 0xffffffffffffffffn) throw new Error('Invalid SFrame integer')
  let length = 1
  while (value >= (1n << BigInt(length * 8))) length++
  const result = new Uint8Array(length)
  for (let i = length - 1; i >= 0; i--) { result[i] = Number(value & 255n); value >>= 8n }
  return result
}
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length } return out }
const buffer = (value: Uint8Array) => value.slice().buffer as ArrayBuffer
export function sframeHeader(kid: bigint, counter: bigint): Uint8Array {
  const k = bytes(kid), c = bytes(counter)
  return concat(new Uint8Array([(kid < 8n ? Number(kid) << 4 : 0x80 | ((k.length - 1) << 4)) | (counter < 8n ? Number(counter) : 8 | (c.length - 1))]), kid < 8n ? new Uint8Array() : k, counter < 8n ? new Uint8Array() : c)
}
function parse(wire: Uint8Array) {
  if (wire.length < 17) throw new Error('Invalid SFrame')
  const config = wire[0]; let at = 1
  function integer(extended: boolean, field: number) {
    if (!extended) return BigInt(field)
    const length = field + 1
    if (wire.length < at + length + 16) throw new Error('Invalid SFrame')
    let value = 0n
    for (let i = 0; i < length; i++) value = (value << 8n) | BigInt(wire[at++])
    if (value < 8n || (length > 1 && value < (1n << BigInt((length - 1) * 8)))) throw new Error('Noncanonical SFrame')
    return value
  }
  const kid = integer(!!(config & 128), (config >> 4) & 7), counter = integer(!!(config & 8), config & 7)
  return { kid, counter, header: wire.slice(0, at), ciphertext: wire.slice(at) }
}
export const sframeKeyId=(wire:Uint8Array)=>parse(wire).kid
export class SFrameCipher {
  private counter = 0n
  private highest = -1n
  private window = 0n
  private constructor(privateKey: CryptoKey, salt: Uint8Array, kid: bigint) { this.key = privateKey; this.salt = salt; this.kid = kid }
  private key: CryptoKey
  private salt: Uint8Array
  private kid: bigint
  static async create(baseKey: Uint8Array, kid: bigint, initialCounter=0n) {
    if (baseKey.length < 16 || baseKey.length > 64) throw new Error('Invalid SFrame base key')
    const value = new Uint8Array(8); value.set(bytes(kid), 8 - bytes(kid).length)
    const input = await crypto.subtle.importKey('raw', buffer(baseKey), 'HKDF', false, ['deriveBits', 'deriveKey'])
    const params = (label: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: new ArrayBuffer(0), info: buffer(concat(new TextEncoder().encode(label), value, new Uint8Array([0, 4]))) })
    const key = await crypto.subtle.deriveKey(params('SFrame 1.0 Secret key '), input, { name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt'])
    const salt = new Uint8Array(await crypto.subtle.deriveBits(params('SFrame 1.0 Secret salt '), input, 96))
    if(initialCounter<0n||initialCounter>=0x100000000n)throw new Error('Invalid SFrame initial counter')
    const cipher=new SFrameCipher(key, salt, kid);cipher.counter=initialCounter;return cipher
  }
  private nonce(counter: bigint) { const result = this.salt.slice(); for (let i = 11; i >= 4; i--) { result[i] ^= Number(counter & 255n); counter >>= 8n } return buffer(result) }
  async encrypt(plaintext: Uint8Array, metadata = new Uint8Array()) {
    const counter = this.counter++
    if (counter < 0n || counter >= 0x100000000n) throw new Error('SFrame key exhausted')
    const header = sframeHeader(this.kid, counter)
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: this.nonce(counter), additionalData: buffer(concat(header, metadata)), tagLength: 128 }, this.key, buffer(plaintext))
    return concat(header, new Uint8Array(encrypted))
  }
  async decrypt(wire: Uint8Array, metadata = new Uint8Array()) {
    const { kid, counter, header, ciphertext } = parse(wire)
    if (kid !== this.kid || counter >= 0x100000000n || (this.highest >= counter && (this.highest - counter >= 128n || (this.window & (1n << (this.highest - counter))) !== 0n))) throw new Error('Rejected SFrame')
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this.nonce(counter), additionalData: buffer(concat(header, metadata)), tagLength: 128 }, this.key, buffer(ciphertext))
    if (counter > this.highest) { const shift = counter - this.highest; this.window = shift >= 128n ? 1n : ((this.window << shift) | 1n) & ((1n << 128n) - 1n); this.highest = counter }
    else this.window |= 1n << (this.highest - counter)
    return new Uint8Array(plaintext)
  }
}
