Current Implementation (as‑is)

Single‑file SPA: index.html loads React UMD, Tailwind CDN, PeerJS; main logic in app.js.
Storage model: meshdesk_state v3 with lamport, eventSeq, snapshotSeq, bounded events; meshdesk_identity holds ECDSA keypair JWKs + fingerprint + peerId; meshdesk_settings includes trust and rate‑limit policy. See app.js.
Security & consistency hardening now implemented:
Cryptographic identity via WebCrypto P‑256 keypair; fingerprint derived from SHA‑256 of SPKI.
Signed events and signed snapshots.
Deterministic conflict resolution using Lamport clocks, tie‑breaks on timestamp then fingerprint.
Per‑peer rate limiting with soft bans.
Role enforcement with local trusted‑elevated allowlist for sensitive actions.
Networking: PeerJS data channels, manual connect by peer ID, snapshot sync and event broadcast, bounded history.
UI: dashboard, tickets, chat, agents, escalations, network, settings. Trust allowlist UI is in Settings.
Note: STORAGE.md is now stale relative to app.js and README.md (still describes v2‑ish structures). SPEC.md is conceptually aligned but doesn’t mention the new trust/rate‑limit mechanisms.
Gaps & Enhancements (Game‑Theory Lens)
Below are features framed by incentives, defection, and coordination problems in a decentralized system. Each item targets an equilibrium where honest/cooperative behavior is the rational choice.

1. Key Rotation + Recovery

Gap: Identity loss on localStorage clear; no recovery, no key rotation.
Game‑theory issue: High cost of accidental defection; users abandon rather than recover.
Feature: Exportable identity bundle, recovery phrase, optional rotation protocol.
2. Sybil Resistance Beyond Local Trust

Gap: Trust allowlist is local only; no network‑level sybil deterrence.
Game‑theory issue: Cheap identities can flood or manipulate.
Feature: Proof‑of‑work throttling for new peers, or invite‑signed onboarding.
3. Reputation / Reciprocity Layer

Gap: No incentive to relay, stay online, or contribute to sync health.
Game‑theory issue: Free‑rider equilibrium.
Feature: Track contribution scores and prefer peers that reciprocate for sync.
4. Deterministic Access Control for Ticket Data

Gap: All connected peers can see all tickets.
Game‑theory issue: Information hoarding or misuse is beneficial if unchecked.
Feature: Ticket‑level access lists, optional encryption per ticket for limited roles.
5. Stronger Event Provenance

Gap: Events are signed but there’s no hash‑chain or append‑only log.
Game‑theory issue: Event omission or selective history is profitable.
Feature: Hash‑chained event log and event‑sequence validation on snapshot.
6. Snapshot Consistency Checks

Gap: Snapshot includes metadata but no strict validation against event history or peer trust.
Game‑theory issue: A malicious peer can send a validly signed but misleading snapshot.
Feature: Require snapshot hash of bounded event log; refuse if mismatch.
7. Explicit Arbitration for Disputes

Gap: Conflict resolution is deterministic but doesn’t capture business rules for disputes.
Game‑theory issue: Parties may “race” valid updates to win.
Feature: State machine rules for ticket transitions with role‑based constraints.
8. Peer Discovery / Room Governance

Gap: Manual peer ID connect; no discovery or governance.
Game‑theory issue: Coordination failure is a dominant outcome.
Feature: Optional hub, roster gossip, or signed peer list with opt‑in.
9. Abuse Controls Beyond Rate Limits

Gap: Rate limits only; no behavioral bans or content moderation.
Game‑theory issue: Spam still profitable if distributed across identities.
Feature: Quarantine mode, peer vote to mute, locally enforced reputation score.
10. Offline Outbox + Guaranteed Delivery

Gap: Messages sent while offline are not queued for later delivery.
Game‑theory issue: Cooperation is risky when connectivity is spotty.
Feature: Local outbox with retry on reconnection.
11. Larger Scalability Controls

Gap: All events broadcast to all peers; bounded history only.
Game‑theory issue: Rational peers may drop due to cost.
Feature: Selective sync (by ticket, by role, by recency), compression.
12. Audit UI

Gap: No UI to inspect signatures, invalid events, bans.
Game‑theory issue: Lack of visibility reduces deterrence.
Feature: Audit view and peer trust dashboard.
13. Policy Synchronization

Gap: Trust list and rate limits are local; no consistency expectations.
Game‑theory issue: Misaligned policies create coordination failures.
Feature: Optional policy sharing with signature and local acceptance.
14. Explicit SLA and Escalation Rules

Gap: Escalation exists but no SLA timers or thresholds.
Game‑theory issue: Agents can delay actions without penalty.
Feature: SLA timers, escalation triggers, and visible accountability.
15. Data Export / Backup

Gap: No export/import of state.
Game‑theory issue: Lock‑in and data loss increase defection risk.
Feature: Export signed snapshots, import with validation.
Quick Priority (Highest Game‑Theory Impact)

Snapshot validation against event log and signer trust.
Reputation/reciprocity for sync participation.
Ticket‑level access control or encryption.
Identity backup and recovery.
Governance for bad actors (mute/quarantine).