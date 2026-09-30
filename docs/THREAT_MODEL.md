# Threat Model (draft)

> Phase 0 draft. It is updated with every phase, and every new server-side field must be
> added to the metadata inventory below.

## Assets

1. Message, attachment, and media plaintext
2. User identity and device private keys, and recovery kits
3. Social graph: who talks to whom, who belongs to which community, and when
4. Account credentials

## Adversaries

| Adversary | Capabilities | Must NOT learn or do |
|---|---|---|
| Honest-but-curious server operator | Full DB, S3, logs, and SFU access | Any content (1). Credentials (4). |
| Malicious server operator | Above, plus modified server code | Content (1). Injecting undetected devices into a user's identity; clients must warn on key changes. |
| Federation peer | Everything its own users can see, plus the S2S traffic it receives | Content of groups it has no members in. |
| Network attacker | Passive or active on the path | Anything beyond TLS-protected traffic metadata. |
| Malicious community member | Legitimate member access | Content from before they joined, beyond what the channel's history policy allows. Content after removal. |
| Bot | Granted channels only | Plaintext of channels it wasn't granted. |
| Lost or stolen device | Local store | Content, if the OS keystore is locked. Continued access once the device is revoked. |

## Metadata inventory (server-visible)

| Data | Why needed | Retention |
|---|---|---|
| `instance_settings` | Operator configuration | Until changed |
| Server signing key | Federation identity | Life of the server |

Phase 1 adds accounts, device public keys, MLS KeyPackages, ciphertext envelopes, and
delivery timestamps. Each gets a row here, with its justification.

## Out of scope (stated honestly)

- Recipients who copy or screenshot content.
- Traffic analysis by an operator (timing, sizes, and membership are visible to the home
  server).
- A compromised client device.
