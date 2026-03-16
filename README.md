# MeshDesk

MeshDesk is a peer-to-peer ticketing system that runs entirely in the browser. It uses PeerJS for signaling and WebRTC data channels for sync between peers. No backend database is required.

This build includes security and consistency hardening:
- Cryptographic identities (WebCrypto keypairs) with signed events and signed snapshots.
- Deterministic conflict resolution using Lamport clocks (no timestamp arbitrage).
- Per-peer rate limits with soft bans to reduce spam/flooding.
- Role enforcement and trusted-elevated allowlist for sensitive actions.
- Snapshot versioning metadata and bounded event history (last 200 events).
- Offline outbox for guaranteed delivery after reconnect.
- SLA timers with automated escalation rules and supervisor alerts.
- Ticket-level access control (ACL) scaffolding for restricted visibility.
- Recovery phrase + encrypted identity bundle + key rotation.
- Signed peer discovery (peer list gossip).
- Optional sybil resistance via proof-of-work on new peer hellos.
- Policy synchronization with signed proposals and local acceptance.
- Full state export/import with signed snapshot validation.
- Selective sync by scope (all/assigned/own) and recency window.

## Quick Start (Local)

MeshDesk is a static app. Serve the files over `http://localhost` (WebRTC is blocked on `file://` in most browsers).

```bash
# From the repo root
python -m http.server 8000
```

Open:
```
http://localhost:8000
```

## App Configuration

Open the app and go to **Settings**:

- **PeerJS Signaling**:
  - Toggle **Use Custom PeerJS Server** if you want your own signaling server.
  - Configure Host/Port/Path/Secure.
- **TURN Relay**:
  - Toggle **Enable TURN**.
  - Configure Host/Port/Username/Credential/TLS.

Changes take effect on reconnect. Use the **Network** view and click **Reconnect PeerJS** if needed.

## Identity, Trust, and Permissions (Important)

### Cryptographic Identity
Each browser generates a P-256 keypair using WebCrypto. The public key fingerprint becomes your stable identity, and your Peer ID is derived from it.

- Identity is created during onboarding and stored in `localStorage`.
- Events and snapshots are signed by the sender.
- Peers reject events/snapshots with invalid signatures.

If you clear storage, you will generate a new identity and appear as a new peer.

### Trusted Elevated Allowlist
Certain actions (escalations and supervisor overrides) are locked behind a local allowlist.

Open **Settings -> Trust & Role Enforcement**:
1. Copy a trusted peer's fingerprint from the "Known peers" list.
2. Add it to the allowlist.

Behavior:
- Only fingerprints in this list can perform escalations and supervisor overrides.
- "Resolve" is allowed for the assigned agent or a trusted elevated peer.
- Customers cannot claim, escalate, or resolve.

This is intentionally local policy: each browser decides who it trusts for elevated actions.

## Consistency Model (How Conflicts Resolve)

MeshDesk uses Lamport clocks to deterministically resolve ticket conflicts:
- Each mutation increments a local Lamport clock.
- Incoming events advance the local clock.
- Ticket updates apply if `clock` is higher; ties break on `updated` timestamp and then fingerprint.

Result:
- No advantage to "racing" timestamps.
- Peers converge on a consistent ticket state.

## Sync and Snapshot Details

- Events are signed and broadcast; snapshots are signed and sent on connect or request.
- Snapshots include metadata: `snapshotVersion`, `snapshotSeq`, and `eventSeq`.
- Event history is bounded to the most recent 200 events.
- Selective sync is supported:
  - Scope: `all`, `assigned`, `own`
  - Recency window (minutes)

If you want to force a resync:
1. Open **Network** view.
2. Click **Sync Now** or **Request Sync**.

## Anti-Spam / Rate Limits

Inbound messages are rate-limited per peer:
- Default window: 10s
- Default max messages: 40
- Soft ban: 60s

If a peer exceeds the limit, they are temporarily ignored. This is local policy.

To adjust limits:
- Open devtools and edit `meshdesk_settings` in `localStorage`.
- Update `security.rateLimit`:
  - `windowMs`
  - `maxMessages`
  - `banMs`

## Local Storage Keys

- `meshdesk_identity`: keypair, fingerprint, display name, role, rotation metadata
- `meshdesk_state`: tickets, events, meta (Lamport/event/snapshot counters)
- `meshdesk_settings`: theme, network config, trust list, rate limits, SLA policy, governance, sync policy, PoW
- `meshdesk_outbox`: offline outbound queue (events and governance messages)
- `meshdesk_peer_votes`: local governance vote tally (per peer)
- `meshdesk_peer_reputation`: local reputation scores

## Governance Controls (Local)

MeshDesk includes lightweight, local-only governance:
- **Vote-to-mute**: peers can broadcast signed votes against a peer.
- **Quarantine**: once vote weight meets the local threshold, the peer is quarantined and inbound messages are ignored.
- **Reputation-backed votes**: votes are weighted by local reputation (higher-reputation peers count more).

Configure in **Settings -> Governance Controls**:
- **Vote Threshold (weight)**: how much vote weight is required to quarantine.
- **Quarantined Peers**: list of currently quarantined peers with release controls.

## Policy Synchronization

Peers can share signed policy proposals (security, SLA, sync). Proposals appear in **Settings -> Policy Synchronization** with Accept/Reject controls. Policy acceptance is local and explicit.

## Offline Outbox (Guaranteed Delivery)

When you are offline or have no open connections, outbound events are queued locally.
On reconnect, the outbox automatically flushes to connected peers. You can also
manually **Flush Outbox** or **Clear** it in the Network view.

## SLA Timers & Escalation Rules

Each ticket carries an SLA window based on priority:
- Low, Medium, High, Critical targets (minutes)
- Auto-escalate if unassigned beyond threshold
- Auto-escalate Critical immediately
- Supervisor alert after a longer unresolved threshold

These rules run locally and emit signed events:
- `SlaBreached`
- `SupervisorAlerted`

Configure in `meshdesk_settings.sla`.

## Ticket-Level Access Control (ACL)

Tickets include a local ACL scaffold:
- `mode: "public" | "restricted"`
- `roles`, `peers`, `fingerprints` allowlists

When `mode` is `restricted`, tickets are only visible to allowed peers.

## Recovery Phrase & Key Rotation

In **Settings -> Recovery Phrase & Rotation** you can:
- Generate a recovery phrase (base32 + checksum)
- Export an encrypted identity bundle
- Import a recovery bundle with the phrase
- Rotate your keypair (creates a signed rotation proof)

## Running Your Own PeerJS Server (Signaling)

You can use the public PeerJS server, but running your own gives you full control.

### Install and Run (Node)

```bash
npm install -g peer
peerjs --port 9000 --path /peerjs
```

### Configure the App

In **Settings -> PeerJS Signaling**:
- Use Custom PeerJS Server: **on**
- Host: `your-hostname-or-ip`
- Port: `9000`
- Path: `/peerjs`
- Secure: **off** for `http`, **on** for `https`

## Running Your Own TURN Server (Relay)

TURN is required when peers cannot connect directly due to NAT/firewall restrictions. Without TURN, some peers will never connect.

### Install coturn (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install coturn -y
```

Enable the service:
```
sudo sed -i 's/^#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
```

### Example `/etc/turnserver.conf`

Replace `PUBLIC_IP`, `PRIVATE_IP`, domain, and credentials.

```
listening-port=3478
tls-listening-port=5349

external-ip=PUBLIC_IP/PRIVATE_IP
relay-ip=PRIVATE_IP
listening-ip=PRIVATE_IP

realm=your-domain.com
lt-cred-mech
user=turnuser:turnpassword
fingerprint

min-port=49152
max-port=65535

log-file=/var/log/turnserver.log
verbose
```

If your VM has **only** a public IP (no private address), use:
```
external-ip=PUBLIC_IP
listening-ip=PUBLIC_IP
```

### Open Firewall Ports

You must allow:
- UDP 3478
- UDP 49152-65535

Optional:
- TCP 3478 (fallback)
- UDP/TCP 5349 (TURN over TLS)

### Start / Restart

```bash
sudo systemctl restart coturn
sudo systemctl status coturn
```

### Configure the App

In **Settings -> TURN Relay**:
- Enable TURN: **on**
- Host: `turn.your-domain.com` (or public IP)
- Port: `3478`
- Username / Credential: your `user=...` values
- Use TLS (turns): **on** only if you configured TLS on coturn

## Troubleshooting

### ICE Stuck at `checking -> disconnected`
This almost always means TURN is unreachable or misconfigured.

Checklist:
- `external-ip` uses the correct public/private mapping.
- TURN ports are open in both cloud security rules and OS firewall.
- `turnserver.log` shows allocation attempts.

### No Sync After Connect
If the Network log shows "Connected" but no "Snapshot synced":
- Click **Sync Now** and **Request Sync**.
- If it says "No open connections to sync," the data channel did not open.
- Enable TURN and reconnect.

## Notes

- The app stores data in `localStorage` per browser.
- WebRTC requires a signaling server (PeerJS). TURN is required for reliability across NAT/firewalls.
## State Export / Import

In **Settings -> State Export & Import** you can:
- Export a signed snapshot of current state.
- Import a snapshot with signature + event log hash validation.

## Peer Discovery

Peers can share signed peer lists (gossip) to help discovery.
- **Network -> Share Peer List** broadcasts your roster.
- **Peer List** button requests a roster from a specific peer.

## Sybil Resistance (PoW)

Optional proof-of-work can be required for new peers:
- **Settings -> Sybil Resistance (Proof of Work)**
- Unknown peers must include a valid PoW token with hello.
