# Storage Design - MeshDesk (P2P)

## localStorage Keys

- `meshdesk_identity`
  - Cryptographic identity bundle used for signing events/snapshots.
  - Fields:
    - `peerId`
    - `displayName`
    - `role`
    - `status`
    - `createdAt`
    - `publicKeyJwk`
    - `privateKeyJwk`
    - `publicKeyFingerprint`

- `meshdesk_state`
  - Full app state + bounded event history.
  - Fields:
    - `agents`: array
    - `tickets`: array
    - `events`: array (bounded, newest-first, max 200)
    - `meta`:
      - `version`: `3`
      - `lamport`
      - `eventSeq`
      - `snapshotSeq`

- `meshdesk_settings`
  - UI + security + networking preferences.
  - Fields:
    - `theme`
    - `sidebarCollapsed`
    - `demoMode`
    - `security`:
      - `trustedElevated`: array of fingerprints
      - `rateLimit`: `{ windowMs, maxMessages, banMs }`
    - `peerServer`:
      - `useCustom`, `host`, `port`, `path`, `secure`
    - `turn`:
      - `enabled`, `host`, `port`, `username`, `credential`, `useTLS`

## Event Structure (signed + hash-chained)

```
{
  "id": "evt_...",
  "type": "TicketCreated" | "TicketAssigned" | "TicketEscalated" | "TicketResolved" | "TicketClosed" | "TicketReopened" | "MessageSent" | ...,
  "ticketId": "#abc123",
  "actor": "Agent Name",
  "actorRole": "L1" | "L2" | "Senior" | "Supervisor" | "Customer",
  "actorPeerId": "peer-...",
  "actorFingerprint": "abcd:1234:...",
  "actorPublicKeyJwk": { ... },
  "ts": "2026-03-16T...Z",
  "detail": "...",
  "ticketHash": "sha256(...)",
  "clock": 42,
  "seq": 17,
  "sig": "base64(ecdsa)",
  "prevHash": "sha256(...)",
  "chainHash": "sha256(prevHash + eventPayload)"
}
```

Notes:
- `sig` signs the event payload (not the chain hash).
- `prevHash`/`chainHash` form a hash-chained log over the bounded event window.

## Ticket Structure (core fields)

```
{
  "id": "#abc123",
  "subject": "...",
  "customer": "Customer Name",
  "customerPeerId": "peer-...",
  "agent": "Agent Name",
  "agentId": "peer-...",
  "status": "Open" | "In Progress" | "Waiting" | "Escalated" | "Resolved" | "Closed",
  "priority": "Low" | "Medium" | "High" | "Critical",
  "messages": [ ... ],
  "created": "2026-03-16T...Z",
  "updated": "2026-03-16T...Z",
  "clock": 42,
  "updatedByFingerprint": "abcd:1234:...",
  "updatedByPeerId": "peer-..."
}
```

## Snapshot Envelope (signed)

```
{
  "type": "snapshot",
  "snapshot": {
    "tickets": [ ... ],
    "events": [ ... ],
    "meta": {
      "snapshotVersion": 1,
      "snapshotSeq": 12,
      "eventSeq": 41,
      "eventChainVersion": 1,
      "eventLogHash": "sha256(...)",
      "eventLogHashAlgo": "sha256"
    }
  },
  "signer": {
    "peerId": "peer-...",
    "fingerprint": "abcd:1234:...",
    "publicKeyJwk": { ... }
  },
  "sig": "base64(ecdsa)"
}
```

## P2P Protocol Messages

- `hello`
  - `{ type: "hello", identity: { ... }, sig }`

- `event`
  - `{ type: "event", event, ticket }`

- `req_snapshot`
  - `{ type: "req_snapshot" }`

- `snapshot`
  - `{ type: "snapshot", snapshot, signer, sig }`

## Notes

- All data is client-side only; PeerJS is used for signaling and WebRTC data channels.
- Events and snapshots are verified by signature; snapshots also validate event log hash and signer fingerprint.
