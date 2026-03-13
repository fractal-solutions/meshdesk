# MeshDesk

MeshDesk is a peer-to-peer ticketing system that runs entirely in the browser. It uses PeerJS for signaling and WebRTC data channels for sync between peers. No backend database is required.

This build includes security and consistency hardening:
- Cryptographic identities (WebCrypto keypairs) with signed events and signed snapshots.
- Deterministic conflict resolution using Lamport clocks (no timestamp arbitrage).
- Per-peer rate limits with soft bans to reduce spam/flooding.
- Role enforcement and trusted-elevated allowlist for sensitive actions.
- Snapshot versioning metadata and bounded event history (last 200 events).

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

Open **Settings → Trust & Role Enforcement**:
1. Copy a trusted peer’s fingerprint from the “Known peers” list.
2. Add it to the allowlist.

Behavior:
- Only fingerprints in this list can perform escalations and supervisor overrides.
- “Resolve” is allowed for the assigned agent or a trusted elevated peer.
- Customers cannot claim, escalate, or resolve.

This is intentionally local policy: each browser decides who it trusts for elevated actions.

## Consistency Model (How Conflicts Resolve)

MeshDesk uses Lamport clocks to deterministically resolve ticket conflicts:
- Each mutation increments a local Lamport clock.
- Incoming events advance the local clock.
- Ticket updates apply if `clock` is higher; ties break on `updated` timestamp and then fingerprint.

Result:
- No advantage to “racing” timestamps.
- Peers converge on a consistent ticket state.

## Sync and Snapshot Details

- Events are signed and broadcast; snapshots are signed and sent on connect or request.
- Snapshots include metadata: `snapshotVersion`, `snapshotSeq`, and `eventSeq`.
- Event history is bounded to the most recent 200 events.

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

- `meshdesk_identity`: keypair, fingerprint, display name, role
- `meshdesk_state`: tickets, events, meta (Lamport/event/snapshot counters)
- `meshdesk_settings`: theme, network config, trust list, rate limits

## Running Your Own PeerJS Server (Signaling)

You can use the public PeerJS server, but running your own gives you full control.

### Install and Run (Node)

```bash
npm install -g peer
peerjs --port 9000 --path /peerjs
```

### Configure the App

In **Settings → PeerJS Signaling**:
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

In **Settings → TURN Relay**:
- Enable TURN: **on**
- Host: `turn.your-domain.com` (or public IP)
- Port: `3478`
- Username / Credential: your `user=...` values
- Use TLS (turns): **on** only if you configured TLS on coturn

## Troubleshooting

### ICE Stuck at `checking → disconnected`
This almost always means TURN is unreachable or misconfigured.

Checklist:
- `external-ip` uses the correct public/private mapping.
- TURN ports are open in both cloud security rules and OS firewall.
- `turnserver.log` shows allocation attempts.

### No Sync After Connect
If the Network log shows “Connected” but no “Snapshot synced”:
- Click **Sync Now** and **Request Sync**.
- If it says “No open connections to sync,” the data channel did not open.
- Enable TURN and reconnect.

## Notes

- The app stores data in `localStorage` per browser.
- WebRTC requires a signaling server (PeerJS). TURN is required for reliability across NAT/firewalls.
