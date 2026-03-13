# Decentralized Live Support & Ticketing Platform — "MeshDesk"

A professional, enterprise-grade **real** decentralized live support and ticketing platform that runs entirely in the browser using **PeerJS** for true peer-to-peer WebRTC data connections. Agents across different browsers/devices can join the same room, share tickets, chat with each other, and manage a distributed ticket queue — all without any backend server (except the PeerJS signaling server for initial connection brokering).

## Architecture

- **PeerJS** for real WebRTC peer-to-peer data channels
- **Room-based networking**: Peers join a named room. The first peer in a room is the "hub" and new peers connect to all existing peers via introductions.
- **State synchronization**: Full state is broadcast on join. Incremental events (ticket created, message sent, etc.) are broadcast to all connected peers in real-time.
- **Cryptographic identity**: Generated locally on first visit using browser crypto APIs.
- **localStorage persistence**: All data persisted locally. Sync with peers on reconnect.
- **Event sourcing**: All mutations are events that are broadcast and replayed.

## Key Differences from Simulation

- No simulated bot agents — all agents are real humans in real browsers
- No fake gossip rounds — real data sync over WebRTC data channels
- Network view shows actual connected peers with real connection status
- Messages are delivered in real-time to all connected peers
- Tickets created on one browser appear on all connected browsers instantly