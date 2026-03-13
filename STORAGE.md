# Storage Design - MeshDesk (Real P2P)

## Data Requirements

- **localStorage**: User identity, theme preferences, sidebar state, active view, all ticket/event data
- **PeerJS**: Real-time state sync between connected browsers
- **No backend needed**: Fully client-side P2P via PeerJS signaling server

## Storage Strategy

### Offline-First (localStorage)
- All data persisted locally
- On peer connect, full state merge occurs
- Events are broadcast incrementally

### Data Structures

```json
// Identity
"meshdesk_identity": {
  "peerId": "meshdesk-abc123def456",
  "publicKeyFingerprint": "a3f2:c9b1:...",
  "displayName": "Agent Smith",
  "role": "L2",
  "status": "Online",
  "createdAt": "2026-03-13T..."
}

// Full app state
"meshdesk_state": {
  "agents": [...],
  "tickets": [...],
  "events": [...]
}

// Settings
"meshdesk_settings": { "theme": "dark", "sidebarCollapsed": false, "roomId": "meshdesk-global" }
```

### P2P Protocol Messages

```json
// Broadcast event
{ "type": "event", "payload": { "eventType": "TicketCreated", ... } }

// Full state sync (on new peer join)
{ "type": "state_sync", "payload": { "tickets": [...], "events": [...] } }

// Peer announce (identity broadcast)
{ "type": "announce", "payload": { "peerId": "...", "displayName": "...", "role": "...", "status": "..." } }

// Peer list (hub sends list of existing peers to new joiner)
{ "type": "peer_list", "payload": ["peer-id-1", "peer-id-2"] }
```

### No API Endpoints Used
- Fully client-side application
- PeerJS uses its free signaling server (0.peerjs.com) for connection brokering only
- All data transfer is direct WebRTC peer-to-peer