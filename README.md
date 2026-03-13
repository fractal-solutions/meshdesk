# MeshDesk

MeshDesk is a peer-to-peer ticketing system that runs entirely in the browser. It uses PeerJS for signaling and WebRTC data channels for sync between peers. No backend database is required.

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
- UDP 49152–65535

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
