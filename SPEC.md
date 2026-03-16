**Current Implementation (as-is)**

Single-file SPA: `index.html` loads React UMD, Tailwind CDN, PeerJS; main logic in `app.js`.
Storage model: `meshdesk_state` v3 with lamport, eventSeq, snapshotSeq, bounded events + event-log hash; `meshdesk_identity` holds ECDSA keypair JWKs + fingerprint + peerId; `meshdesk_settings` includes trust, governance, SLA, and rate-limit policy. See `app.js`.

Security & consistency hardening now implemented:
- Cryptographic identity via WebCrypto P-256 keypair; fingerprint derived from SHA-256 of SPKI.
- Signed events and signed snapshots.
- Hash-chained event log (per-event prevHash/chainHash) and snapshot eventLogHash validation.
- Snapshot signer fingerprint verification and eventSeq sanity checks.
- Deterministic conflict resolution using Lamport clocks, tie-breaks on timestamp then fingerprint.
- Per-peer rate limiting with soft bans.
- Role enforcement with local trusted-elevated allowlist for sensitive actions.
- Offline outbox for guaranteed delivery after reconnect.
- SLA timers and escalation rules (auto-escalate, supervisor alerts) with signed events.
- Ticket-level access control (ACL) scaffolding for restricted visibility.
- Recovery phrase + encrypted identity bundle + key rotation with rotation proof.
- Governance controls: vote-to-mute, quarantine, reputation-weighted votes, local reputation scoring.

Networking: PeerJS data channels, manual connect by peer ID, snapshot sync and event broadcast, bounded history.
UI: dashboard, tickets, chat, agents, escalations, network, audit, settings. Trust allowlist + identity backup + governance + SLA controls in Settings.
Audit: dedicated panel for signature failures, snapshot mismatches, chain errors, soft bans, and governance/reputation actions. Filter/search + export JSON/CSV.

**Kanban (Game-Theory Lens)**
Below are features framed by incentives, defection, and coordination problems in a decentralized system. Each item targets an equilibrium where honest/cooperative behavior is the rational choice.

**Now (Implemented)**
1. Stronger Event Provenance
Gap: Events are signed but there’s no hash-chain or append-only log.
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
Implemented: Local reputation scoring used for vote weighting; audit-backed adjustments.
Game-theory issue: Free-rider equilibrium.
Next: Use reputation to prefer peers for sync and relay.

**Next (Planned)**
1. Sybil Resistance Beyond Local Trust
Gap: Trust allowlist is local only; no network-level sybil deterrence.
Game-theory issue: Cheap identities can flood or manipulate.
Feature: Proof-of-work throttling for new peers, or invite-signed onboarding.

2. Explicit Arbitration for Disputes
Gap: Conflict resolution is deterministic but doesn’t capture business rules for disputes.
Game-theory issue: Parties may “race” valid updates to win.
Feature: State machine rules for ticket transitions with role-based constraints.

3. Peer Discovery / Room Governance
Gap: Manual peer ID connect; no discovery or governance.
Game-theory issue: Coordination failure is a dominant outcome.
Feature: Optional hub, roster gossip, or signed peer list with opt-in.

4. Larger Scalability Controls
Gap: All events broadcast to all peers; bounded history only.
Game-theory issue: Rational peers may drop due to cost.
Feature: Selective sync (by ticket, by role, by recency), compression.

5. Policy Synchronization
Gap: Trust list and rate limits are local; no consistency expectations.
Game-theory issue: Misaligned policies create coordination failures.
Feature: Optional policy sharing with signature and local acceptance.

6. Data Export / Backup (Full State)
Gap: No export/import of full state.
Game-theory issue: Lock-in and data loss increase defection risk.
Feature: Export signed snapshots, import with validation (identity bundle already implemented).

7. Ticket Data Encryption
Gap: ACL is visibility-only; data not encrypted.
Game-theory issue: Unauthorized peers could still access if they obtain state.
Feature: Per-ticket encryption with role/peer key distribution.

**Quick Priority (Highest Game-Theory Impact)**
- Ticket data encryption (beyond ACL visibility).
- Full state export/import with validation.
- Policy synchronization (trust/governance alignment).
- Peer discovery / room governance.
- Sybil resistance beyond local trust.
- Arbitration rules for disputes.
- Selective sync and compression.
