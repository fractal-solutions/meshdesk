**Current Implementation (as-is)**

Single-file SPA: `index.html` loads React UMD, Tailwind CDN, PeerJS; main logic in `app.js`.
Storage model: `meshdesk_state` v3 with lamport, eventSeq, snapshotSeq, bounded events + event-log hash; `meshdesk_identity` holds ECDSA keypair JWKs + fingerprint + peerId; `meshdesk_settings` includes trust, governance, SLA, sync, and rate-limit policy. See `app.js`.

Security and consistency hardening now implemented:
- Cryptographic identity via WebCrypto P-256 keypair; fingerprint derived from SHA-256 of SPKI.
- Signed events and signed snapshots.
- Hash-chained event log (per-event prevHash/chainHash) and snapshot eventLogHash validation.
- Snapshot signer fingerprint verification and eventSeq sanity checks.
- Deterministic conflict resolution using Lamport clocks, tie-breaks on timestamp then fingerprint.
- Per-peer rate limiting with soft bans.
- Role enforcement with local trusted-elevated allowlist for sensitive actions.
- Offline outbox for guaranteed delivery after reconnect.
- SLA timers and escalation rules (auto-escalate, supervisor alerts) with signed events.
- Ticket-level access control (ACL) scaffolding for restricted visibility (no encryption yet).
- Recovery phrase + encrypted identity bundle + key rotation with rotation proof.
- Governance controls: vote-to-mute, quarantine, reputation-weighted votes, local reputation scoring.
- Policy synchronization with signed proposals and local acceptance.
- Full state export/import with signed snapshot validation.
- Selective sync by scope (all/assigned/own), recency window, per-ticket selection, and optional compression.
- Peer discovery via signed peer list gossip and request/response.
- Sybil resistance via optional proof-of-work for new peers.

Networking: PeerJS data channels, manual connect by peer ID, snapshot sync and event broadcast, bounded history.
UI: dashboard, tickets, chat, agents, escalations, network, audit, settings. Trust allowlist + identity backup + governance + SLA + sync controls in Settings.
Audit: dedicated panel for signature failures, snapshot mismatches, chain errors, soft bans, governance actions. Filter/search + export JSON/CSV and action buttons.

**Kanban (Game-Theory Lens)**
Below are features framed by incentives, defection, and coordination problems in a decentralized system. Each item targets an equilibrium where honest/cooperative behavior is the rational choice.

**Now (Implemented)**
1. Stronger Event Provenance
Gap: Events are signed but there is no hash-chain or append-only log.
Implemented: Hash-chained event log with per-event prevHash/chainHash.
Game-theory issue: Event omission or selective history is profitable.
Feature: Hash-chained event log and event-sequence validation on snapshot.
Next: Enforce append-only validation when full history is available.

2. Snapshot Consistency Checks
Gap: Snapshot includes metadata but no strict validation against event history or peer trust.
Implemented: Snapshot hash of bounded event log + signer fingerprint checks + eventSeq sanity check.
Game-theory issue: A malicious peer can send a validly signed but misleading snapshot.
Feature: Require snapshot hash of bounded event log; refuse if mismatch.
Next: Optional policy to require snapshots only from trusted fingerprints.

3. Audit UI
Implemented: Audit panel for signature failures, snapshot mismatches, chain errors, soft bans, and governance actions. Filter + export.
Game-theory issue: Lack of visibility reduces deterrence.
Next: Optional remote audit sharing (opt-in).

4. Identity Recovery + Rotation
Gap: Identity loss on localStorage clear; no recovery phrase or rotation protocol.
Implemented: Recovery phrase, encrypted identity bundle export/import, key rotation with rotation proof.
Game-theory issue: High cost of accidental defection; users abandon rather than recover.

5. Offline Outbox + Guaranteed Delivery
Gap: Messages sent while offline are not queued for later delivery.
Implemented: Local outbox with retry on reconnection, manual flush/clear.
Game-theory issue: Cooperation is risky when connectivity is spotty.

6. SLA Timers + Escalation Rules
Gap: Escalation exists but no SLA timers or thresholds.
Implemented: SLA timers, auto-escalation, supervisor alerts, signed events.
Game-theory issue: Agents can delay actions without penalty.

7. Deterministic Access Control (ACL Scaffold)
Gap: All connected peers can see all tickets.
Implemented: Ticket-level ACL scaffold with restricted visibility.
Game-theory issue: Information hoarding or misuse is beneficial if unchecked.
Next: Optional encryption per ticket for limited roles.

8. Governance for Bad Actors
Gap: Rate limits only; no behavioral bans or content moderation.
Implemented: Vote-to-mute, quarantine, reputation-weighted votes, local reputation scoring.
Game-theory issue: Spam still profitable if distributed across identities.
Next: Shared moderation signals, content filters, and appeal flow.

9. Reputation / Reciprocity Layer (Baseline)
Gap: No incentive to relay, stay online, or contribute to sync health.
Implemented: Local reputation scoring used for vote weighting and peer preference for sync; audit-backed adjustments.
Game-theory issue: Free-rider equilibrium.
Next: Use reputation to prefer peers for sync and relay.

10. Peer Discovery / Room Governance
Gap: Manual peer ID connect; no discovery or governance.
Implemented: Signed peer list gossip + request/response for peer rosters.
Game-theory issue: Coordination failure is a dominant outcome.
Next: Optional hub / signed room roster for broader discovery.

11. Sybil Resistance Beyond Local Trust
Gap: Trust allowlist is local only; no network-level sybil deterrence.
Implemented: Optional proof-of-work requirement for new peers (hello handshake).
Game-theory issue: Cheap identities can flood or manipulate.
Next: Invite-signed onboarding or adaptive PoW by reputation.

12. Larger Scalability Controls (Selective Sync)
Gap: All events broadcast to all peers; bounded history only.
Implemented: Selective snapshot sync by scope (all/assigned/own) + recency window + per-ticket selection, with optional gzip compression.
Game-theory issue: Rational peers may drop due to cost.
Next: Per-ticket delta sync and event-level compression (optional).

13. Policy Synchronization
Gap: Trust list and rate limits are local; no consistency expectations.
Implemented: Policy sharing with signature and local acceptance.
Game-theory issue: Misaligned policies create coordination failures.

14. Data Export / Backup (Full State)
Gap: No export/import of full state.
Implemented: Export signed snapshots, import with validation.
Game-theory issue: Lock-in and data loss increase defection risk.

15. Explicit Arbitration for Disputes (Baseline)
Gap: Conflict resolution is deterministic but does not capture business rules for disputes.
Implemented: State machine validation for ticket transitions (assign/escalate/resolve/close/reopen) with role-based constraints.
Game-theory issue: Parties may race valid updates to win.
Next: Expand arbitration rules to cover business-specific workflows and dispute states.

**Next (Planned)**
1. Ticket Data Encryption
Gap: ACL is visibility-only; data not encrypted.
Game-theory issue: Unauthorized peers could still access if they obtain state.
Feature: Per-ticket encryption with role/peer key distribution.

**Quick Priority (Highest Game-Theory Impact)**
- Ticket data encryption (beyond ACL visibility).
- Arbitration rules for disputes.
