const { useState, useEffect, useCallback, useRef, useMemo, createElement: h, Fragment } = React;

// ============ UTILITY FUNCTIONS ============
const genId = () => Math.random().toString(36).substr(2, 9);
const genTicketId = () => '#' + Math.random().toString(16).substr(2, 6);
const timeAgo = (ts) => {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return Math.max(1, Math.floor(diff/1000)) + 's ago';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  return Math.floor(diff/86400000) + 'd ago';
};
const addMinutes = (iso, mins) => new Date(new Date(iso).getTime() + mins * 60000).toISOString();
const minutesSince = (iso) => (Date.now() - new Date(iso).getTime()) / 60000;
const genAvatar = (seed) => {
  const colors = ['#6366F1','#EC4899','#10B981','#F59E0B','#3B82F6','#8B5CF6','#EF4444','#14B8A6'];
  const c = colors[Math.abs(seed.split('').reduce((a,b) => a + b.charCodeAt(0), 0)) % colors.length];
  return c;
};
const ROLE_RANK = { 'Customer': 0, 'L1': 1, 'L2': 2, 'Senior': 3, 'Supervisor': 4 };
const getRoleRank = (role) => ROLE_RANK[role] ?? 0;
const textEncoder = new TextEncoder();
const bufferToHex = (buffer) => Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
const bufferToBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
const base64ToBuffer = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
const EVENT_CHAIN_GENESIS = '0'.repeat(64);
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const encodeBase32 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
};
const decodeBase32 = (str) => {
  const clean = (str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes).buffer;
};
const formatRecoveryPhrase = (base32) => {
  const clean = base32.replace(/[^A-Z2-7]/gi, '').toUpperCase();
  return clean.match(/.{1,4}/g)?.join('-') || clean;
};
const parseRecoveryPhrase = (phrase) => (phrase || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
const supportsCompression = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
const compressJson = async (payload) => {
  const json = JSON.stringify(payload);
  if (!supportsCompression()) return { ok: false, error: 'unsupported' };
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const compressed = await new Response(stream).arrayBuffer();
  return { ok: true, data: bufferToBase64(compressed) };
};
const decompressJson = async (b64) => {
  if (!supportsCompression()) return { ok: false, error: 'unsupported' };
  const buffer = base64ToBuffer(b64 || '');
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  const text = await new Response(stream).text();
  return { ok: true, data: JSON.parse(text) };
};
const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
};
const exportPublicKeyFingerprint = async (publicKey) => {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  const digest = await crypto.subtle.digest('SHA-256', spki);
  const hex = bufferToHex(digest);
  return hex.match(/.{1,4}/g)?.join(':') || hex;
};
const generateIdentityKeys = async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const [publicKeyJwk, privateKeyJwk] = await Promise.all([
    crypto.subtle.exportKey('jwk', keyPair.publicKey),
    crypto.subtle.exportKey('jwk', keyPair.privateKey)
  ]);
  const fingerprint = await exportPublicKeyFingerprint(keyPair.publicKey);
  const peerId = 'peer-' + fingerprint.replace(/:/g, '').slice(0, 12);
  return { publicKeyJwk, privateKeyJwk, fingerprint, peerId };
};
const fingerprintFromPublicJwk = async (publicKeyJwk) => {
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify']
    );
    return await exportPublicKeyFingerprint(key);
  } catch (e) {
    return null;
  }
};
const signPayload = async (privateKeyJwk, payload) => {
  const key = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const data = textEncoder.encode(stableStringify(payload));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
  return bufferToBase64(sig);
};
const hashPayload = async (payload) => {
  const data = textEncoder.encode(stableStringify(payload));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(digest);
};
const verifyPayload = async (publicKeyJwk, payload, signature) => {
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const data = textEncoder.encode(stableStringify(payload));
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      base64ToBuffer(signature),
      data
    );
  } catch (e) {
    return false;
  }
};
const generateRecoveryPhrase = async () => {
  const entropy = crypto.getRandomValues(new Uint8Array(16));
  const checksum = await crypto.subtle.digest('SHA-256', entropy);
  const checksumBytes = new Uint8Array(checksum).slice(0, 2);
  const combined = new Uint8Array(18);
  combined.set(entropy, 0);
  combined.set(checksumBytes, 16);
  return formatRecoveryPhrase(encodeBase32(combined));
};
const verifyRecoveryPhrase = async (phrase) => {
  try {
    const raw = decodeBase32(parseRecoveryPhrase(phrase));
    const bytes = new Uint8Array(raw);
    if (bytes.length < 18) return false;
    const entropy = bytes.slice(0, 16);
    const checksum = bytes.slice(16, 18);
    const digest = await crypto.subtle.digest('SHA-256', entropy);
    const digestBytes = new Uint8Array(digest).slice(0, 2);
    return checksum[0] === digestBytes[0] && checksum[1] === digestBytes[1];
  } catch (e) {
    return false;
  }
};
const deriveRecoveryKey = async (phrase, salt, iterations = 200000) => {
  const phraseData = textEncoder.encode(parseRecoveryPhrase(phrase));
  const baseKey = await crypto.subtle.importKey('raw', phraseData, { name: 'PBKDF2' }, false, ['deriveKey']);
  return await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};
const encryptIdentityBundle = async (identity, phrase) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveRecoveryKey(phrase, salt);
  const payload = textEncoder.encode(JSON.stringify(identity));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
  return {
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: 200000,
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(ciphertext)
  };
};
const decryptIdentityBundle = async (bundle, phrase) => {
  const salt = new Uint8Array(base64ToBuffer(bundle.salt || ''));
  const iv = new Uint8Array(base64ToBuffer(bundle.iv || ''));
  const iterations = bundle.iterations || 200000;
  const key = await deriveRecoveryKey(phrase, salt, iterations);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    base64ToBuffer(bundle.ciphertext || '')
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
};
const downloadJson = (filename, payload) => {
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (e) {}
};
const downloadCsv = (filename, rows) => {
  try {
    const escape = (val) => {
      const s = String(val ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/\"/g, '""')}"`;
      }
      return s;
    };
    const csv = rows.map(row => row.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (e) {}
};
const checkPowHash = (hash, difficulty) => {
  if (!difficulty || difficulty <= 0) return true;
  return hash.startsWith('0'.repeat(difficulty));
};
const generatePowToken = async (peerId, fingerprint, difficulty, maxAttempts = 20000) => {
  if (!difficulty || difficulty <= 0) return null;
  let nonce = 0;
  for (let i = 0; i < maxAttempts; i++) {
    nonce = Math.floor(Math.random() * 1e9);
    const hash = await hashPayload({ nonce, peerId, fingerprint });
    if (checkPowHash(hash, difficulty)) {
      return { nonce, hash, difficulty, ts: new Date().toISOString() };
    }
  }
  return null;
};
const verifyPowToken = async (token, peerId, fingerprint, difficulty) => {
  if (!difficulty || difficulty <= 0) return true;
  if (!token?.nonce || !token?.hash) return false;
  const computed = await hashPayload({ nonce: token.nonce, peerId, fingerprint });
  return computed === token.hash && checkPowHash(computed, difficulty);
};

// ============ DATA GENERATION ============
const AGENT_NAMES = ['Alex Chen', 'Maya Johnson', 'Raj Patel', 'Sofia Martinez', 'Liam O\'Brien', 'Yuki Tanaka', 'Awa Diallo', 'Marcus Weber'];
const CUSTOMER_NAMES = ['James Wilson', 'Emily Davis', 'Michael Brown', 'Sarah Taylor', 'David Lee', 'Emma White', 'Robert Garcia', 'Lisa Anderson', 'John Martin', 'Maria Hernandez', 'Chris Thomas', 'Amanda Jackson'];
const CATEGORIES = ['Billing', 'Technical', 'Account', 'General'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const STATUSES = ['Open', 'In Progress', 'Waiting', 'Escalated', 'Resolved', 'Closed'];
const ROLES = ['L1', 'L2', 'Senior', 'Supervisor'];
const IDENTITY_ROLES = ['Customer', 'L1', 'L2', 'Senior', 'Supervisor'];
const AVAIL = ['Online', 'Busy', 'Idle', 'Offline'];

const TICKET_SUBJECTS = [
  'Cannot access my account after password reset',
  'Billing discrepancy on latest invoice',
  'API integration returning 500 errors',
  'Feature request: bulk export functionality',
  'Slow response times in EU region',
  'Two-factor authentication not working',
  'Subscription upgrade not reflected',
  'Data migration assistance needed',
  'SSL certificate renewal failing',
  'Mobile app crashes on login',
  'Missing transactions in dashboard',
  'Webhook delivery delays',
  'Permission denied for team members',
  'Custom domain configuration help',
  'Rate limiting too aggressive',
  'Need help with SAML SSO setup',
  'Invoice address change request',
  'Dashboard metrics not updating',
  'API key rotation procedure',
  'Service degradation noticed'
];

const SAMPLE_MESSAGES = [
  'I\'ve been experiencing this issue for the past two days. Can someone please help?',
  'I\'ve tried clearing my cache and cookies but the problem persists.',
  'This is affecting our entire team and blocking our workflow.',
  'Thanks for looking into this. Any update on the timeline?',
  'I can confirm the issue is still occurring as of this morning.',
  'We need this resolved ASAP as it\'s impacting our customers.',
  'Let me know if you need any additional information from my side.',
  'I\'ve attached screenshots showing the error messages.',
  'Our integration has been down since yesterday afternoon.',
  'Is there a workaround we can use in the meantime?'
];

const AGENT_RESPONSES = [
  'I\'m looking into this right now. Give me a moment to check our systems.',
  'I\'ve identified the issue and am working on a fix. Should be resolved within the hour.',
  'Could you provide your account ID so I can look into this more specifically?',
  'I\'ve escalated this to our engineering team for immediate attention.',
  'The fix has been deployed. Could you try again and let me know if it works?',
  'I understand the urgency. Let me prioritize this for you.',
  'I\'ve checked our logs and can see the errors you\'re reporting. Working on it now.',
  'Thanks for your patience. We\'re making progress on this.',
  'I\'ve applied a temporary fix while we work on a permanent solution.',
  'This should be fully resolved now. Please verify on your end.'
];

function generateInitialData() {
  return { tickets: [], events: [], meta: { version: 3, lamport: 0, eventSeq: 0, snapshotSeq: 0 } };
}

// ============ LOAD/SAVE ============
function loadState() {
  try {
    const saved = localStorage.getItem('meshdesk_state');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.meta?.version === 3) return parsed;
      if (parsed?.meta?.version === 2) {
        const events = parsed.events || [];
        const tickets = parsed.tickets || [];
        const maxEventClock = events.reduce((m, e) => Math.max(m, e.clock || 0), 0);
        const maxTicketClock = tickets.reduce((m, t) => Math.max(m, t.clock || 0), 0);
        const maxSeq = events.reduce((m, e) => Math.max(m, e.seq || 0), 0);
        return {
          ...parsed,
          meta: { version: 3, lamport: Math.max(maxEventClock, maxTicketClock), eventSeq: maxSeq, snapshotSeq: 0 }
        };
      }
      return null;
    }
  } catch(e) {}
  return null;
}

function saveState(state) {
  try {
    const toSave = { ...state, meta: { ...state.meta, version: 3 } };
    localStorage.setItem('meshdesk_state', JSON.stringify(toSave));
  } catch(e) {}
}

function loadSettings() {
  const defaults = {
    theme: 'dark',
    sidebarCollapsed: false,
    demoMode: false,
    security: {
      trustedElevated: [],
      mutedPeers: [],
      quarantinedPeers: [],
      voteThreshold: 2,
      pow: { enabled: false, difficulty: 3 },
      rateLimit: { windowMs: 10000, maxMessages: 40, banMs: 60000 }
    },
    sync: {
      recentMinutes: 0,
      scope: 'all',
      ticketIds: [],
      compression: 'none',
      maxPeers: 0,
      preferReputation: true
    },
    peerServer: {
      useCustom: false,
      host: 'localhost',
      port: 9000,
      path: '/peerjs',
      secure: false
    },
    turn: {
      enabled: false,
      host: '',
      port: 3478,
      username: '',
      credential: '',
      useTLS: false
    },
    sla: {
      enabled: true,
      targetsMins: { Low: 480, Medium: 240, High: 120, Critical: 60 },
      autoEscalateAfterMins: 10,
      autoEscalateCritical: true,
      supervisorAlertAfterMins: 30
    }
  };
  try {
    const s = localStorage.getItem('meshdesk_settings');
    if (s) {
      const parsed = JSON.parse(s);
      return {
        ...defaults,
        ...parsed,
        security: {
          ...defaults.security,
          ...(parsed.security || {}),
          mutedPeers: parsed.security?.mutedPeers || defaults.security.mutedPeers,
          quarantinedPeers: parsed.security?.quarantinedPeers || defaults.security.quarantinedPeers,
          voteThreshold: parsed.security?.voteThreshold ?? defaults.security.voteThreshold,
          pow: { ...defaults.security.pow, ...(parsed.security?.pow || {}) },
          rateLimit: { ...defaults.security.rateLimit, ...(parsed.security?.rateLimit || {}) }
        },
        peerServer: { ...defaults.peerServer, ...(parsed.peerServer || {}) },
        turn: { ...defaults.turn, ...(parsed.turn || {}) },
        sync: { ...defaults.sync, ...(parsed.sync || {}), ticketIds: parsed.sync?.ticketIds || defaults.sync.ticketIds },
        sla: {
          ...defaults.sla,
          ...(parsed.sla || {}),
          targetsMins: { ...defaults.sla.targetsMins, ...(parsed.sla?.targetsMins || {}) }
        }
      };
    }
  } catch(e) {}
  return defaults;
}

function saveSettings(s) {
  try { localStorage.setItem('meshdesk_settings', JSON.stringify(s)); } catch(e) {}
}

function loadOutbox() {
  try {
    const saved = localStorage.getItem('meshdesk_outbox');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

function saveOutbox(outbox) {
  try { localStorage.setItem('meshdesk_outbox', JSON.stringify(outbox)); } catch (e) {}
}

function loadIdentity() {
  try {
    const i = localStorage.getItem('meshdesk_identity');
    if (i) return JSON.parse(i);
  } catch(e) {}
  return null;
}

function saveIdentity(i) {
  try { localStorage.setItem('meshdesk_identity', JSON.stringify(i)); } catch(e) {}
}

// ============ MERGE HELPERS ============
function mergeTickets(local, incoming) {
  const byId = new Map(local.map(t => [t.id, t]));
  for (const t of incoming || []) {
    const existing = byId.get(t.id);
    if (!existing) {
      byId.set(t.id, t);
      continue;
    }
    const aClock = t.clock || 0;
    const bClock = existing.clock || 0;
    if (aClock !== bClock) {
      if (aClock > bClock) byId.set(t.id, t);
      continue;
    }
    const aUpdated = new Date(t.updated).getTime() || 0;
    const bUpdated = new Date(existing.updated).getTime() || 0;
    if (aUpdated !== bUpdated) {
      if (aUpdated > bUpdated) byId.set(t.id, t);
      continue;
    }
    const aBy = t.updatedByFingerprint || t.agentId || t.customerPeerId || '';
    const bBy = existing.updatedByFingerprint || existing.agentId || existing.customerPeerId || '';
    if (aBy && bBy && aBy !== bBy && aBy > bBy) byId.set(t.id, t);
  }
  return Array.from(byId.values());
}

function mergeEvents(local, incoming) {
  const byId = new Map(local.map(e => [e.id, e]));
  for (const e of incoming || []) {
    if (!byId.has(e.id)) byId.set(e.id, e);
  }
  return Array.from(byId.values())
    .sort(compareEventsDesc)
    .slice(0, 200);
}

function compareEventsDesc(a, b) {
  const clockDiff = (b.clock || 0) - (a.clock || 0);
  if (clockDiff !== 0) return clockDiff;
  const tsDiff = new Date(b.ts).getTime() - new Date(a.ts).getTime();
  if (tsDiff !== 0) return tsDiff;
  return (b.id || '').localeCompare(a.id || '');
}

function compareEventsAsc(a, b) {
  const clockDiff = (a.clock || 0) - (b.clock || 0);
  if (clockDiff !== 0) return clockDiff;
  const tsDiff = new Date(a.ts).getTime() - new Date(b.ts).getTime();
  if (tsDiff !== 0) return tsDiff;
  return (a.id || '').localeCompare(b.id || '');
}

// ============ STATUS COLORS ============
const statusColor = (s) => ({
  'Open': 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  'In Progress': 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  'Waiting': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'Escalated': 'bg-red-500/15 text-red-400 border-red-500/30',
  'Resolved': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  'Closed': 'bg-slate-500/15 text-slate-400 border-slate-500/30',
}[s] || 'bg-slate-500/15 text-slate-400');

const priorityColor = (p) => ({
  'Critical': '#EF4444', 'High': '#F97316', 'Medium': '#F59E0B', 'Low': '#3B82F6'
}[p] || '#64748B');

const availColor = (s) => ({
  'Online': '#10B981', 'Busy': '#F59E0B', 'Idle': '#94A3B8', 'Offline': '#EF4444'
}[s] || '#64748B');

const roleStyle = (r) => ({
  'Customer': 'bg-emerald-500/15 text-emerald-400',
  'L1': 'bg-blue-500/15 text-blue-400', 'L2': 'bg-purple-500/15 text-purple-400',
  'Senior': 'bg-amber-500/15 text-amber-400', 'Supervisor': 'bg-red-500/15 text-red-400'
}[r] || 'bg-slate-500/15 text-slate-400');

// ============ ICON COMPONENTS ============
const Icon = ({ name, size = 16, className = '' }) => {
  const icons = {
    dashboard: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4',
    ticket: 'M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z',
    chat: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    users: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    escalation: 'M13 10V3L4 14h7v7l9-11h-7z',
    network: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9',
    settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    plus: 'M12 4v16m8-8H4',
    send: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8',
    search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
    close: 'M6 18L18 6M6 6l12 12',
    check: 'M5 13l4 4L19 7',
    arrow_up: 'M5 10l7-7m0 0l7 7m-7-7v18',
    arrow_down: 'M19 14l-7 7m0 0l-7-7m7 7V3',
    chevron_right: 'M9 5l7 7-7 7',
    chevron_left: 'M15 19l-7-7 7-7',
    menu: 'M4 6h16M4 12h16M4 18h16',
    sun: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z',
    moon: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z',
    filter: 'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z',
    claim: 'M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11',
    key: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z',
    audit: 'M12 2l7 3v6c0 4.5-3 8.5-7 9-4-0.5-7-4.5-7-9V5l7-3z'
  };
  const d = icons[name] || icons.dashboard;
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', className }, h('path', { d }));
};

// ============ TOAST SYSTEM ============
let toastId = 0;
const ToastContext = React.createContext();

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((msg, type = 'info') => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, msg, type, removing: false }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, removing: true } : t));
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300);
    }, 4000);
  }, []);

  return h(ToastContext.Provider, { value: addToast },
    children,
    h('div', { className: 'fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none' },
      toasts.map(t =>
        h('div', {
          key: t.id,
          className: `pointer-events-auto px-4 py-3 rounded-lg shadow-lg border text-sm font-medium max-w-sm ${t.removing ? 'animate-toast-out' : 'animate-toast-in'} ${
            t.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
            t.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
            t.type === 'warning' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
            'bg-brand-500/10 border-brand-500/30 text-brand-400'
          }`
        }, t.msg)
      )
    )
  );
}

// ============ MAIN APP ============
function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [identity, setIdentity] = useState(loadIdentity);
  const [showOnboarding, setShowOnboarding] = useState(!loadIdentity());
  const [view, setView] = useState('dashboard');
  const [state, setState] = useState(() => loadState() || generateInitialData());
  const [outbox, setOutbox] = useState(loadOutbox);
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(!settings.sidebarCollapsed);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterPriority, setFilterPriority] = useState('All');
  const [networkStatus, setNetworkStatus] = useState('idle');
  const [gossipRound, setGossipRound] = useState(0);
  const [syncLog, setSyncLog] = useState([]);
  const simTimerRef = useRef(null);
  const [peerStatus, setPeerStatus] = useState('idle');
  const [peerId, setPeerId] = useState(identity?.peerId || null);
  const [connectTarget, setConnectTarget] = useState('');
  const [connections, setConnections] = useState([]);
  const [knownPeers, setKnownPeers] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [pendingPolicies, setPendingPolicies] = useState([]);
  const [peerVotes, setPeerVotes] = useState(() => {
    try {
      const saved = localStorage.getItem('meshdesk_peer_votes');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });
  const [peerReputation, setPeerReputation] = useState(() => {
    try {
      const saved = localStorage.getItem('meshdesk_peer_reputation');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });
  const [peerRestartNonce, setPeerRestartNonce] = useState(0);
  const peerRef = useRef(null);
  const connsRef = useRef(new Map());
  const stateRef = useRef(state);
  const outboxRef = useRef(outbox);
  const suppressBroadcastRef = useRef(false);
  const seenEventsRef = useRef(new Set());
  const lamportRef = useRef(state.meta?.lamport || 0);
  const eventSeqRef = useRef(state.meta?.eventSeq || 0);
  const snapshotSeqRef = useRef(state.meta?.snapshotSeq || 0);
  const peerRateRef = useRef(new Map());
  const knownPeersRef = useRef(new Map());
  const eventChainHeadRef = useRef(EVENT_CHAIN_GENESIS);
  const identityRef = useRef(identity);
  const peerLifecycleRef = useRef(0);
  const setupConnectionRef = useRef(null);
  const logSyncRef = useRef(null);
  const updateConnectionsStateRef = useRef(null);

  const isDark = settings.theme === 'dark';
  const knownPeersById = useMemo(() => {
    const map = new Map();
    (knownPeers || []).forEach(p => {
      if (p.peerId) map.set(p.peerId, p);
    });
    return map;
  }, [knownPeers]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  useEffect(() => { saveState(state); }, [state]);
  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => {
    try { localStorage.setItem('meshdesk_peer_votes', JSON.stringify(peerVotes || {})); } catch (e) {}
  }, [peerVotes]);
  useEffect(() => {
    try { localStorage.setItem('meshdesk_peer_reputation', JSON.stringify(peerReputation || {})); } catch (e) {}
  }, [peerReputation]);
  useEffect(() => {
    outboxRef.current = outbox;
    saveOutbox(outbox);
  }, [outbox]);
  useEffect(() => { identityRef.current = identity; }, [identity]);
  useEffect(() => {
    lamportRef.current = state.meta?.lamport || lamportRef.current || 0;
    eventSeqRef.current = state.meta?.eventSeq || eventSeqRef.current || 0;
    snapshotSeqRef.current = state.meta?.snapshotSeq || snapshotSeqRef.current || 0;
  }, [state.meta]);
  useEffect(() => {
    const cache = seenEventsRef.current;
    for (const e of state.events) cache.add(e.id);
  }, [state.events]);

  useEffect(() => {
    if (!identity) return;
    if (!identity.publicKeyJwk || !identity.privateKeyJwk || !identity.publicKeyFingerprint) {
      (async () => {
        const keys = await generateIdentityKeys();
        const updated = {
          ...identity,
          publicKeyJwk: keys.publicKeyJwk,
          privateKeyJwk: keys.privateKeyJwk,
          publicKeyFingerprint: keys.fingerprint,
          peerId: identity.peerId || keys.peerId
        };
        setIdentity(updated);
        saveIdentity(updated);
        setPeerId(updated.peerId);
      })();
    }
  }, [identity]);

  useEffect(() => {
    if (!identity?.publicKeyFingerprint) return;
    setSettings(s => {
      const trusted = s.security?.trustedElevated || [];
      if (trusted.includes(identity.publicKeyFingerprint)) return s;
      return { ...s, security: { ...s.security, trustedElevated: [identity.publicKeyFingerprint, ...trusted] } };
    });
  }, [identity?.publicKeyFingerprint]);

  // Simulated bot activity
  useEffect(() => {
    if (!settings.demoMode) return;
    const interval = setInterval(() => {
      setState(prev => {
        const updated = { ...prev };
        const agents = [...updated.agents];
        const tickets = [...updated.tickets];
        const events = [...updated.events];
        const now = new Date().toISOString();

        // Random agent status change
        if (Math.random() > 0.7) {
          const aIdx = Math.floor(Math.random() * agents.length);
          const newStatus = AVAIL[Math.floor(Math.random() * 3)];
          agents[aIdx] = { ...agents[aIdx], status: newStatus, lastSeen: now };
          events.unshift({ id: genId(), type: 'AgentStatus', ticketId: null, actor: agents[aIdx].name, ts: now, detail: `Status → ${newStatus}` });
        }

        // Random ticket claim
        if (Math.random() > 0.8) {
          const openTickets = tickets.filter(t => !t.agent && t.status === 'Open');
          const onlineAgents = agents.filter(a => a.status === 'Online');
          if (openTickets.length > 0 && onlineAgents.length > 0) {
            const t = openTickets[0];
            const a = onlineAgents[Math.floor(Math.random() * onlineAgents.length)];
            const tIdx = tickets.findIndex(x => x.id === t.id);
            tickets[tIdx] = { ...t, agent: a.name, agentId: a.id, status: 'In Progress', updated: now };
            events.unshift({ id: genId(), type: 'TicketAssigned', ticketId: t.id, actor: a.name, ts: now, detail: `Claimed by ${a.name}` });
          }
        }

        // Random message
        if (Math.random() > 0.75) {
          const activeTickets = tickets.filter(t => t.status === 'In Progress' && t.agent);
          if (activeTickets.length > 0) {
            const t = activeTickets[Math.floor(Math.random() * activeTickets.length)];
            const tIdx = tickets.findIndex(x => x.id === t.id);
            const isAgent = Math.random() > 0.4;
            const msg = {
              id: genId(),
              type: isAgent ? 'agent' : 'customer',
              sender: isAgent ? t.agent : t.customer,
              text: isAgent ? AGENT_RESPONSES[Math.floor(Math.random() * AGENT_RESPONSES.length)] : SAMPLE_MESSAGES[Math.floor(Math.random() * SAMPLE_MESSAGES.length)],
              ts: now
            };
            tickets[tIdx] = { ...t, messages: [...t.messages, msg], updated: now };
            events.unshift({ id: genId(), type: 'MessageSent', ticketId: t.id, actor: msg.sender, ts: now, detail: msg.text.substring(0, 60) + '...' });
          }
        }

        // Random resolve
        if (Math.random() > 0.92) {
          const inProg = tickets.filter(t => t.status === 'In Progress');
          if (inProg.length > 0) {
            const t = inProg[Math.floor(Math.random() * inProg.length)];
            const tIdx = tickets.findIndex(x => x.id === t.id);
            tickets[tIdx] = { ...t, status: 'Resolved', updated: now };
            events.unshift({ id: genId(), type: 'TicketResolved', ticketId: t.id, actor: t.agent || 'System', ts: now, detail: 'Ticket resolved' });
          }
        }

        return { agents, tickets, events: events.slice(0, 200) };
      });

      // Gossip simulation
      setGossipRound(prev => prev + 1);
      setSyncLog(prev => {
        const peerId = genId().substring(0, 6);
        const evtCount = Math.floor(Math.random() * 20) + 1;
        const entry = { id: genId(), ts: new Date().toISOString(), msg: `Synced ${evtCount} events with peer ${peerId}` };
        return [entry, ...prev].slice(0, 50);
      });

      // Flicker network status occasionally
      if (Math.random() > 0.9) {
        setNetworkStatus('syncing');
        setTimeout(() => setNetworkStatus('connected'), 2000);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [settings.demoMode]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setShowCreateModal(true); }
      if (e.key === 'Escape') { setSelectedTicketId(null); setShowCreateModal(false); }
      if (e.key === '/') { e.preventDefault(); document.getElementById('search-input')?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const toggleTheme = () => setSettings(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }));

  const handleCreateIdentity = async (name, role, keyMaterial) => {
    const keys = keyMaterial || await generateIdentityKeys();
    const id = {
      peerId: keys.peerId,
      publicKeyFingerprint: keys.fingerprint,
      publicKeyJwk: keys.publicKeyJwk,
      privateKeyJwk: keys.privateKeyJwk,
      displayName: name || 'Agent ' + genId().substring(0, 4),
      role: role || 'L1',
      status: 'Online',
      createdAt: new Date().toISOString()
    };
    setIdentity(id);
    saveIdentity(id);
    setPeerId(id.peerId);
    setShowOnboarding(false);
  };

  const logAudit = useCallback((msg, level = 'warning', peerIdToLog = null, meta = {}) => {
    const entry = { id: genId(), ts: new Date().toISOString(), msg, level, peerId: peerIdToLog, ...meta };
    setAuditLog(prev => [entry, ...prev].slice(0, 200));
  }, []);

  const logSync = useCallback((msg, type = 'info') => {
    const entry = { id: genId(), ts: new Date().toISOString(), msg, type };
    setSyncLog(prev => [entry, ...prev].slice(0, 80));
  }, []);

  const sendToOpenConnections = useCallback((payload) => {
    let sent = 0;
    connsRef.current.forEach(conn => {
      if (conn.open) {
        try {
          conn.send(payload);
          sent += 1;
        } catch (e) {}
      }
    });
    return sent;
  }, []);

  const enqueueOutbound = useCallback((payload, reason = 'offline') => {
    if (!payload) return;
    const entry = {
      id: genId(),
      payload,
      reason,
      createdAt: new Date().toISOString(),
      attempts: 0,
      lastAttempt: null
    };
    setOutbox(prev => [...prev, entry].slice(-500));
    logSync(`Queued outbound ${payload.type || 'payload'} (${reason})`, 'warning');
  }, [logSync]);

  const flushOutbox = useCallback((reason = 'auto') => {
    if (!outboxRef.current.length) return;
    const openCount = Array.from(connsRef.current.values()).filter(c => c.open).length;
    if (!openCount) {
      logSync('Outbox flush skipped: no open connections', 'warning');
      return;
    }
    setOutbox(prev => {
      const now = new Date().toISOString();
      const remaining = [];
      let sentTotal = 0;
      let attempted = 0;
      for (const entry of prev) {
        attempted += 1;
        const sent = sendToOpenConnections(entry.payload);
        if (sent > 0) {
          sentTotal += 1;
          continue;
        }
        remaining.push({
          ...entry,
          attempts: (entry.attempts || 0) + 1,
          lastAttempt: now
        });
      }
      if (sentTotal > 0) {
        logSync(`Outbox delivered ${sentTotal}/${attempted} queued items (${reason})`, 'success');
      }
      return remaining;
    });
  }, [logSync, sendToOpenConnections]);

  const bumpLamport = useCallback((remoteClock = 0) => {
    lamportRef.current = Math.max(lamportRef.current, remoteClock || 0) + 1;
    return lamportRef.current;
  }, []);

  const observeLamport = useCallback((remoteClock = 0) => {
    lamportRef.current = Math.max(lamportRef.current, remoteClock || 0);
  }, []);

  const bumpEventSeq = useCallback(() => {
    eventSeqRef.current += 1;
    return eventSeqRef.current;
  }, []);

  const bumpSnapshotSeq = useCallback(() => {
    snapshotSeqRef.current += 1;
    return snapshotSeqRef.current;
  }, []);

  const syncMeta = useCallback(() => {
    setState(prev => ({
      ...prev,
      meta: {
        ...prev.meta,
        version: 3,
        lamport: lamportRef.current,
        eventSeq: eventSeqRef.current,
        snapshotSeq: snapshotSeqRef.current
      }
    }));
  }, []);

  const getIdentityPayload = useCallback(() => {
    if (!identity?.publicKeyJwk || !identity?.publicKeyFingerprint) return null;
    return {
      peerId: identity.peerId,
      displayName: identity.displayName,
      role: identity.role,
      publicKeyFingerprint: identity.publicKeyFingerprint,
      publicKeyJwk: identity.publicKeyJwk,
      createdAt: identity.createdAt
    };
  }, [identity]);

  const getPolicyPayload = useCallback(() => {
    const security = settings.security || {};
    return {
      policy: {
        security: {
          trustedElevated: security.trustedElevated || [],
          mutedPeers: security.mutedPeers || [],
          quarantinedPeers: security.quarantinedPeers || [],
          voteThreshold: security.voteThreshold ?? 2,
          pow: security.pow || { enabled: false, difficulty: 3 },
          rateLimit: security.rateLimit || { windowMs: 10000, maxMessages: 40, banMs: 60000 }
        },
        sla: settings.sla || {},
        sync: settings.sync || {}
      },
      signer: {
        peerId: identity?.peerId || null,
        fingerprint: identity?.publicKeyFingerprint || null,
        publicKeyJwk: identity?.publicKeyJwk || null
      }
    };
  }, [identity?.peerId, identity?.publicKeyFingerprint, identity?.publicKeyJwk, settings.security, settings.sla, settings.sync]);

  const getEventSignPayload = useCallback((evt) => ({
    id: evt.id,
    type: evt.type,
    ticketId: evt.ticketId,
    actor: evt.actor,
    actorRole: evt.actorRole,
    actorPeerId: evt.actorPeerId,
    actorFingerprint: evt.actorFingerprint,
    actorPublicKeyJwk: evt.actorPublicKeyJwk,
    ts: evt.ts,
    detail: evt.detail,
    ticketHash: evt.ticketHash,
    clock: evt.clock,
    seq: evt.seq
  }), []);

  const getEventChainPayload = useCallback((evt) => ({
    ...getEventSignPayload(evt),
    sig: evt.sig || null
  }), [getEventSignPayload]);

  const computeEventLogHash = useCallback(async (events, options = {}) => {
    const allowLooseStart = !!options.allowLooseStart;
    const ordered = [...(events || [])].sort(compareEventsAsc);
    let prevHash = EVENT_CHAIN_GENESIS;
    for (let i = 0; i < ordered.length; i++) {
      const evt = ordered[i];
      if (evt.prevHash && evt.prevHash !== prevHash) {
        if (allowLooseStart && i === 0) {
          prevHash = evt.prevHash;
        } else {
          return { ok: false, hash: null };
        }
      }
      const chainPayload = { prevHash, event: getEventChainPayload(evt) };
      const chainHash = await hashPayload(chainPayload);
      if (evt.chainHash && evt.chainHash !== chainHash) {
        return { ok: false, hash: null };
      }
      prevHash = chainHash;
    }
    return { ok: true, hash: prevHash };
  }, [getEventChainPayload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await computeEventLogHash(state.events);
      if (!cancelled && result.ok) eventChainHeadRef.current = result.hash || EVENT_CHAIN_GENESIS;
    })();
    return () => { cancelled = true; };
  }, [computeEventLogHash, state.events]);

  const getSnapshotSignPayload = useCallback((snapshotEnvelope) => ({
    snapshot: snapshotEnvelope.snapshot,
    signer: snapshotEnvelope.signer
  }), []);

  const verifySignedIdentity = useCallback(async (payload, sig) => {
    if (!payload?.publicKeyJwk || !payload?.publicKeyFingerprint || !sig) return false;
    return await verifyPayload(payload.publicKeyJwk, payload, sig);
  }, []);

  const verifySignedEvent = useCallback(async (evt) => {
    if (!evt?.actorPublicKeyJwk || !evt?.actorFingerprint || !evt?.sig) return false;
    return await verifyPayload(evt.actorPublicKeyJwk, getEventSignPayload(evt), evt.sig);
  }, [getEventSignPayload]);

  const verifySignedSnapshot = useCallback(async (snapshotEnvelope) => {
    if (!snapshotEnvelope?.signer?.publicKeyJwk || !snapshotEnvelope?.signer?.fingerprint || !snapshotEnvelope?.sig) return false;
    return await verifyPayload(snapshotEnvelope.signer.publicKeyJwk, getSnapshotSignPayload(snapshotEnvelope), snapshotEnvelope.sig);
  }, [getSnapshotSignPayload]);

  const verifyPolicyEnvelope = useCallback(async (envelope) => {
    if (!envelope?.policy || !envelope?.signer?.publicKeyJwk || !envelope?.signer?.fingerprint || !envelope?.sig) return false;
    const verified = await verifyPayload(envelope.signer.publicKeyJwk, { policy: envelope.policy, signer: envelope.signer }, envelope.sig);
    if (!verified) return false;
    const computed = await fingerprintFromPublicJwk(envelope.signer.publicKeyJwk);
    if (!computed || computed !== envelope.signer.fingerprint) return false;
    return true;
  }, []);

  const verifySnapshotSigner = useCallback(async (snapshotEnvelope, peerIdToCheck) => {
    const signer = snapshotEnvelope?.signer;
    if (!signer?.publicKeyJwk || !signer?.fingerprint) return false;
    const computedFingerprint = await fingerprintFromPublicJwk(signer.publicKeyJwk);
    if (!computedFingerprint || computedFingerprint !== signer.fingerprint) return false;
    if (peerIdToCheck) {
      const known = knownPeersById.get(peerIdToCheck);
      if (known?.publicKeyFingerprint && known.publicKeyFingerprint !== signer.fingerprint) return false;
    }
    return true;
  }, [knownPeersById]);

  const verifySnapshotSignerLoose = useCallback(async (snapshotEnvelope) => {
    const signer = snapshotEnvelope?.signer;
    if (!signer?.publicKeyJwk || !signer?.fingerprint) return false;
    const computedFingerprint = await fingerprintFromPublicJwk(signer.publicKeyJwk);
    return !!computedFingerprint && computedFingerprint === signer.fingerprint;
  }, []);

  const shouldAllowInbound = useCallback((peerIdToCheck) => {
    const muted = settings.security?.mutedPeers || [];
    const quarantined = settings.security?.quarantinedPeers || [];
    if (quarantined.includes(peerIdToCheck)) return false;
    if (muted.includes(peerIdToCheck)) return false;
    const rate = settings.security?.rateLimit || { windowMs: 10000, maxMessages: 40, banMs: 60000 };
    const now = Date.now();
    const entry = peerRateRef.current.get(peerIdToCheck) || { count: 0, windowStart: now, bannedUntil: 0 };
    if (entry.bannedUntil && entry.bannedUntil > now) return false;
    if (now - entry.windowStart > rate.windowMs) {
      entry.windowStart = now;
      entry.count = 0;
    }
    entry.count += 1;
      if (entry.count > rate.maxMessages) {
        entry.bannedUntil = now + rate.banMs;
        peerRateRef.current.set(peerIdToCheck, entry);
        logSync(`Soft-ban ${peerIdToCheck} for ${Math.floor(rate.banMs / 1000)}s`, 'warning');
        logAudit(`Soft-ban ${peerIdToCheck} for ${Math.floor(rate.banMs / 1000)}s`, 'warning', peerIdToCheck);
        adjustReputation(peerIdToCheck, null, -5, 'rate-limit');
        return false;
      }
    peerRateRef.current.set(peerIdToCheck, entry);
    return true;
  }, [logAudit, logSync, settings.security]);

  const isTrustedElevated = useCallback((fingerprint) => {
    const trusted = settings.security?.trustedElevated || [];
    return trusted.includes(fingerprint);
  }, [settings.security]);

  const getRepScoreForPeer = useCallback((peerId) => {
    const known = knownPeersById.get(peerId);
    const key = known?.publicKeyFingerprint || peerId;
    return peerReputation?.[key]?.score ?? 50;
  }, [knownPeersById, peerReputation]);

  const getReputationKey = useCallback((peerId, fingerprint) => {
    return fingerprint || peerId || null;
  }, []);

  const adjustReputation = useCallback((peerId, fingerprint, delta, reason) => {
    const key = getReputationKey(peerId, fingerprint);
    if (!key) return;
    setPeerReputation(prev => {
      const current = prev[key] || { score: 50, lastTs: null };
      const nextScore = Math.max(0, Math.min(100, (current.score || 50) + delta));
      return { ...prev, [key]: { score: nextScore, lastTs: new Date().toISOString() } };
    });
    if (reason) {
      logAudit(`Reputation ${delta > 0 ? 'increased' : 'decreased'} (${reason})`, delta > 0 ? 'info' : 'warning', peerId || null, { actorFingerprint: fingerprint || null, eventType: 'ReputationUpdate' });
    }
  }, [getReputationKey, logAudit]);

  const addQuarantine = useCallback((peerIdToQuarantine) => {
    if (!peerIdToQuarantine) return;
    setSettings(s => ({
      ...s,
      security: {
        ...s.security,
        quarantinedPeers: Array.from(new Set([peerIdToQuarantine, ...(s.security?.quarantinedPeers || [])]))
      }
    }));
    logAudit('Peer quarantined locally', 'warning', peerIdToQuarantine);
  }, [logAudit, setSettings]);

  const removeQuarantine = useCallback((peerIdToRelease) => {
    if (!peerIdToRelease) return;
    setSettings(s => ({
      ...s,
      security: {
        ...s.security,
        quarantinedPeers: (s.security?.quarantinedPeers || []).filter(p => p !== peerIdToRelease)
      }
    }));
    logAudit('Peer quarantine removed', 'info', peerIdToRelease);
  }, [logAudit, setSettings]);

  const recordVote = useCallback((payload) => {
    if (!payload?.targetPeerId || !payload?.voterFingerprint) return;
    const threshold = settings.security?.voteThreshold ?? 2;
    const repKey = getReputationKey(payload.voterPeerId, payload.voterFingerprint);
    const repScore = repKey ? (peerReputation?.[repKey]?.score ?? 50) : 50;
    const weight = repScore >= 80 ? 2 : repScore <= 20 ? 0.5 : 1;
    setPeerVotes(prev => {
      const current = prev[payload.targetPeerId] || { voters: [], count: 0, weight: 0, lastTs: null };
      if (current.voters.includes(payload.voterFingerprint)) return prev;
      const updated = {
        voters: [...current.voters, payload.voterFingerprint],
        count: current.count + 1,
        weight: (current.weight || 0) + weight,
        lastTs: payload.ts || new Date().toISOString()
      };
      const next = { ...prev, [payload.targetPeerId]: updated };
      if (updated.weight >= threshold) {
        addQuarantine(payload.targetPeerId);
        logAudit(`Peer auto-quarantined by votes (weight ${updated.weight}/${threshold})`, 'warning', payload.targetPeerId, { eventType: 'PeerVoteMuted' });
      }
      return next;
    });
    logAudit(`Peer vote recorded for ${payload.targetPeerId}`, 'info', payload.targetPeerId, { eventType: 'PeerVoteMuted', actorFingerprint: payload.voterFingerprint });
  }, [addQuarantine, getReputationKey, logAudit, peerReputation, settings.security]);

  const castVoteMute = useCallback(async (targetPeerId) => {
    if (!identity?.privateKeyJwk || !identity?.publicKeyFingerprint) return;
    if (!targetPeerId) return;
    const payload = {
      type: 'PeerVoteMuted',
      targetPeerId,
      voterPeerId: identity.peerId,
      voterFingerprint: identity.publicKeyFingerprint,
      voterPublicKeyJwk: identity.publicKeyJwk,
      ts: new Date().toISOString()
    };
    const sig = await signPayload(identity.privateKeyJwk, payload);
    const envelope = { type: 'peer_vote', payload, sig };
    recordVote(payload);
    const sent = sendToOpenConnections(envelope);
    if (!sent) enqueueOutbound(envelope, 'offline');
    logAudit(`Voted to mute ${targetPeerId}`, 'info', targetPeerId, { eventType: 'PeerVoteMuted' });
  }, [enqueueOutbound, identity, recordVote, sendToOpenConnections]);

  const upsertKnownPeer = useCallback((peerInfo) => {
    if (!peerInfo?.publicKeyFingerprint) return;
    knownPeersRef.current.set(peerInfo.publicKeyFingerprint, peerInfo);
    setKnownPeers(prev => {
      const existing = prev.find(p => p.publicKeyFingerprint === peerInfo.publicKeyFingerprint);
      if (existing) {
        return prev.map(p => p.publicKeyFingerprint === peerInfo.publicKeyFingerprint ? { ...existing, ...peerInfo } : p);
      }
      return [peerInfo, ...prev];
    });
  }, []);

  const sendHello = useCallback(async (conn) => {
    const payload = getIdentityPayload();
    if (!payload || !identity?.privateKeyJwk) return;
    const sig = await signPayload(identity.privateKeyJwk, payload);
    let pow = null;
    const powCfg = settings.security?.pow || { enabled: false, difficulty: 3 };
    if (powCfg.enabled && payload.peerId && payload.publicKeyFingerprint) {
      pow = await generatePowToken(payload.peerId, payload.publicKeyFingerprint, powCfg.difficulty);
      if (!pow) {
        logSync('PoW generation failed; sending hello without proof', 'warning');
      }
    }
    try { conn.send({ type: 'hello', identity: payload, sig, pow }); } catch (e) {}
  }, [getIdentityPayload, identity?.privateKeyJwk, logSync, settings.security]);

  const sendPolicyToAll = useCallback(async () => {
    if (!identity?.privateKeyJwk) return;
    const payload = getPolicyPayload();
    if (!payload?.policy || !payload?.signer?.publicKeyJwk || !payload?.signer?.fingerprint) return;
    const sig = await signPayload(identity.privateKeyJwk, { policy: payload.policy, signer: payload.signer });
    const envelope = { type: 'policy', policy: payload.policy, signer: payload.signer, sig };
    let sent = 0;
    connsRef.current.forEach(conn => {
      if (conn.open) {
        try { conn.send(envelope); sent++; } catch (e) {}
      }
    });
    if (!sent) {
      logSync('No open connections to share policy', 'warning');
    } else {
      logSync(`Policy shared with ${sent} peer(s)`);
      logAudit(`Policy shared`, 'info', identity.peerId, { eventType: 'PolicySync', actorFingerprint: identity.publicKeyFingerprint });
    }
  }, [getPolicyPayload, identity?.peerId, identity?.privateKeyJwk, identity?.publicKeyFingerprint, logAudit, logSync]);

  const getPeerListEnvelope = useCallback(async () => {
    if (!identity?.privateKeyJwk || !identity?.publicKeyJwk || !identity?.publicKeyFingerprint) return null;
    const peers = [
      {
        peerId: identity.peerId,
        displayName: identity.displayName,
        role: identity.role,
        publicKeyFingerprint: identity.publicKeyFingerprint,
        publicKeyJwk: identity.publicKeyJwk,
        createdAt: identity.createdAt
      },
      ...Array.from(knownPeersRef.current.values())
    ];
    const signer = {
      peerId: identity.peerId,
      fingerprint: identity.publicKeyFingerprint,
      publicKeyJwk: identity.publicKeyJwk
    };
    const sig = await signPayload(identity.privateKeyJwk, { peers, signer });
    return { type: 'peer_list', peers, signer, sig };
  }, [identity]);

  const sendPeerListToAll = useCallback(async () => {
    const envelope = await getPeerListEnvelope();
    if (!envelope) return;
    let sent = 0;
    connsRef.current.forEach(conn => {
      if (conn.open) {
        try { conn.send(envelope); sent++; } catch (e) {}
      }
    });
    if (!sent) {
      logSync('No open connections to share peer list', 'warning');
    } else {
      logSync(`Peer list shared with ${sent} peer(s)`);
      logAudit('Peer list shared', 'info', identity?.peerId || null, { eventType: 'PeerDiscovery' });
    }
  }, [getPeerListEnvelope, identity?.peerId, logAudit, logSync]);

  const sendPeerListToConn = useCallback(async (conn) => {
    const envelope = await getPeerListEnvelope();
    if (!envelope || !conn?.open) return;
    try { conn.send(envelope); } catch (e) {}
  }, [getPeerListEnvelope]);

  const createSignedEvent = useCallback(async (evt) => {
    if (!identity?.privateKeyJwk || !identity?.publicKeyJwk || !identity?.publicKeyFingerprint) return null;
    const payload = {
      ...evt,
      actorRole: identity.role,
      actorPeerId: identity.peerId,
      actorFingerprint: identity.publicKeyFingerprint,
      actorPublicKeyJwk: identity.publicKeyJwk
    };
    const sig = await signPayload(identity.privateKeyJwk, getEventSignPayload(payload));
    const withSig = { ...payload, sig };
    const prevHash = eventChainHeadRef.current || EVENT_CHAIN_GENESIS;
    const chainHash = await hashPayload({ prevHash, event: getEventChainPayload(withSig) });
    eventChainHeadRef.current = chainHash;
    return { ...withSig, prevHash, chainHash };
  }, [getEventChainPayload, getEventSignPayload, identity]);

  const updateConnectionsState = useCallback(() => {
    const list = Array.from(connsRef.current.values()).map(conn => ({
      peerId: conn.peer,
      open: conn.open
    }));
    setConnections(list);
    setNetworkStatus(list.length > 0 ? 'connected' : 'idle');
  }, []);

  const sendSnapshot = useCallback(async (conn) => {
    if (!identity?.privateKeyJwk || !identity?.publicKeyJwk || !identity?.publicKeyFingerprint) return;
    const recentMinutes = settings.sync?.recentMinutes || 0;
    const scope = settings.sync?.scope || 'all';
    const ticketIds = (settings.sync?.ticketIds || []).filter(Boolean);
    let snapshotTickets = stateRef.current.tickets;
    if (scope !== 'all' && identity?.peerId) {
      snapshotTickets = snapshotTickets.filter(t => {
        if (scope === 'assigned') return t.agentId === identity.peerId;
        if (scope === 'own') return t.agentId === identity.peerId || t.customerPeerId === identity.peerId;
        return true;
      });
    }
    if (ticketIds.length) {
      snapshotTickets = snapshotTickets.filter(t => ticketIds.includes(t.id));
    }
    const allowedIds = new Set(snapshotTickets.map(t => t.id));
    let snapshotEvents = stateRef.current.events.slice(0, 200).filter(e => {
      if (!e.ticketId) return scope === 'all' && ticketIds.length === 0;
      return allowedIds.has(e.ticketId);
    });
    if (recentMinutes > 0) {
      const cutoff = Date.now() - recentMinutes * 60 * 1000;
      snapshotEvents = snapshotEvents.filter(e => new Date(e.ts).getTime() >= cutoff);
    }
    const isPartial = recentMinutes > 0 || scope !== 'all' || ticketIds.length > 0;
    const eventLog = await computeEventLogHash(snapshotEvents, { allowLooseStart: isPartial });
    if (!eventLog.ok) {
      logSync('Snapshot aborted: invalid event chain', 'warning');
      return;
    }
    const snapshot = {
      tickets: snapshotTickets,
      events: snapshotEvents,
      meta: {
        snapshotVersion: 1,
        snapshotSeq: bumpSnapshotSeq(),
        eventSeq: eventSeqRef.current,
        eventChainVersion: 1,
        eventLogHash: eventLog.hash,
        eventLogPartial: isPartial,
        eventLogHashAlgo: 'sha256',
        syncScope: scope,
        syncRecentMinutes: recentMinutes,
        syncTicketIds: ticketIds
      }
    };
    const signer = {
      peerId: identity.peerId,
      fingerprint: identity.publicKeyFingerprint,
      publicKeyJwk: identity.publicKeyJwk
    };
    const envelope = { type: 'snapshot', snapshot, signer };
    const sig = await signPayload(identity.privateKeyJwk, getSnapshotSignPayload(envelope));
    try {
      const compression = settings.sync?.compression || 'none';
      if (compression === 'gzip' && supportsCompression()) {
        const compressed = await compressJson({ ...envelope, sig });
        if (compressed.ok) {
          conn.send({ type: 'snapshot_compressed', algo: 'gzip', data: compressed.data });
          logSync(`Snapshot (compressed) sent to ${conn.peer}`);
        } else {
          conn.send({ ...envelope, sig });
          logSync(`Snapshot sent to ${conn.peer}`);
        }
      } else {
        conn.send({ ...envelope, sig });
        logSync(`Snapshot sent to ${conn.peer}`);
      }
      syncMeta();
    } catch (e) {
      logSync(`Snapshot failed to ${conn.peer}`, 'error');
    }
  }, [bumpSnapshotSeq, computeEventLogHash, getSnapshotSignPayload, identity, logSync, settings.sync, syncMeta]);

  const sendSnapshotToAll = useCallback(() => {
    let conns = Array.from(connsRef.current.values()).filter(conn => conn.open);
    const maxPeers = settings.sync?.maxPeers || 0;
    if (settings.sync?.preferReputation) {
      conns = conns.sort((a, b) => getRepScoreForPeer(b.peer) - getRepScoreForPeer(a.peer));
    }
    if (maxPeers > 0) conns = conns.slice(0, maxPeers);
    let sent = 0;
    conns.forEach(conn => {
      void sendSnapshot(conn);
      sent++;
    });
    if (!sent) logSync('No open connections to sync', 'warning');
  }, [getRepScoreForPeer, logSync, sendSnapshot, settings.sync]);

  const exportStateSnapshot = useCallback(async () => {
    if (!identity?.privateKeyJwk || !identity?.publicKeyJwk || !identity?.publicKeyFingerprint) return;
    const snapshotEvents = stateRef.current.events.slice(0, 200);
    const eventLog = await computeEventLogHash(snapshotEvents);
    if (!eventLog.ok) {
      logSync('State export aborted: invalid event chain', 'warning');
      logAudit('State export aborted (invalid event chain)', 'warning', identity.peerId);
      return;
    }
    const snapshot = {
      tickets: stateRef.current.tickets,
      events: snapshotEvents,
      meta: {
        snapshotVersion: 1,
        snapshotSeq: snapshotSeqRef.current + 1,
        eventSeq: eventSeqRef.current,
        eventChainVersion: 1,
        eventLogHash: eventLog.hash,
        eventLogHashAlgo: 'sha256'
      }
    };
    const signer = {
      peerId: identity.peerId,
      fingerprint: identity.publicKeyFingerprint,
      publicKeyJwk: identity.publicKeyJwk
    };
    const envelope = { type: 'snapshot', snapshot, signer };
    const sig = await signPayload(identity.privateKeyJwk, getSnapshotSignPayload(envelope));
    downloadJson(`meshdesk-state-${identity.peerId}-${Date.now()}.json`, { ...envelope, sig });
    logAudit('State export completed', 'info', identity.peerId, { eventType: 'StateExport' });
  }, [computeEventLogHash, getSnapshotSignPayload, identity, logAudit, logSync]);

  const acceptPolicyProposal = useCallback((policyEntry) => {
    if (!policyEntry?.policy) return;
    setSettings(s => ({
      ...s,
      security: {
        ...s.security,
        ...(policyEntry.policy.security || {}),
        rateLimit: { ...s.security.rateLimit, ...(policyEntry.policy.security?.rateLimit || {}) }
      },
      sla: { ...s.sla, ...(policyEntry.policy.sla || {}) },
      sync: { ...s.sync, ...(policyEntry.policy.sync || {}) }
    }));
    setPendingPolicies(prev => prev.filter(p => p.id !== policyEntry.id));
    logAudit('Policy accepted', 'info', policyEntry.signer?.peerId || null, { eventType: 'PolicySync', signerFingerprint: policyEntry.signer?.fingerprint || null });
  }, [logAudit]);

  const rejectPolicyProposal = useCallback((policyEntry) => {
    if (!policyEntry) return;
    setPendingPolicies(prev => prev.filter(p => p.id !== policyEntry.id));
    logAudit('Policy rejected', 'info', policyEntry.signer?.peerId || null, { eventType: 'PolicySync', signerFingerprint: policyEntry.signer?.fingerprint || null });
  }, [logAudit]);

  const applySnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    const incomingEvents = snapshot.events || [];
    const incomingTickets = snapshot.tickets || [];
    const maxEventClock = incomingEvents.reduce((m, e) => Math.max(m, e.clock || 0), 0);
    const maxTicketClock = incomingTickets.reduce((m, t) => Math.max(m, t.clock || 0), 0);
    observeLamport(Math.max(maxEventClock, maxTicketClock));
    eventSeqRef.current = Math.max(eventSeqRef.current, snapshot.meta?.eventSeq || 0);
    snapshotSeqRef.current = Math.max(snapshotSeqRef.current, snapshot.meta?.snapshotSeq || 0);
    suppressBroadcastRef.current = true;
    setState(prev => ({
      ...prev,
      tickets: mergeTickets(prev.tickets, incomingTickets),
      events: mergeEvents(prev.events, incomingEvents),
      meta: {
        ...prev.meta,
        eventSeq: Math.max(prev.meta?.eventSeq || 0, snapshot.meta?.eventSeq || 0),
        snapshotSeq: Math.max(prev.meta?.snapshotSeq || 0, snapshot.meta?.snapshotSeq || 0),
        lamport: Math.max(prev.meta?.lamport || 0, lamportRef.current)
      }
    }));
    setTimeout(() => { suppressBroadcastRef.current = false; }, 0);
  }, [observeLamport]);

  const importStateSnapshot = useCallback(async (text) => {
    try {
      const data = JSON.parse(text || '');
      if (!data?.snapshot || !data?.signer || !data?.sig) return { ok: false, msg: 'Invalid snapshot file.' };
      const verified = await verifySignedSnapshot(data);
      if (!verified) return { ok: false, msg: 'Snapshot signature invalid.' };
      const signerOk = await verifySnapshotSignerLoose(data);
      if (!signerOk) return { ok: false, msg: 'Signer fingerprint mismatch.' };
      const declaredHash = data.snapshot?.meta?.eventLogHash;
      if (!declaredHash) return { ok: false, msg: 'Snapshot missing event log hash.' };
      const eventLog = await computeEventLogHash(data.snapshot?.events || [], { allowLooseStart: !!data.snapshot?.meta?.eventLogPartial });
      if (!eventLog.ok || eventLog.hash !== declaredHash) return { ok: false, msg: 'Snapshot event log hash mismatch.' };
      applySnapshot(data.snapshot);
      logAudit('State import completed', 'info', data.signer?.peerId || null, { eventType: 'StateImport', signerFingerprint: data.signer?.fingerprint || null });
      return { ok: true, msg: 'State imported successfully.' };
    } catch (e) {
      return { ok: false, msg: 'Failed to parse snapshot.' };
    }
  }, [applySnapshot, computeEventLogHash, logAudit, verifySignedSnapshot, verifySnapshotSignerLoose]);

  const handleIncomingSnapshot = useCallback(async (data, peerIdToCheck) => {
    if (!data?.snapshot) return;
    if (!shouldAllowInbound(peerIdToCheck)) return;
    const signerFingerprint = data?.signer?.fingerprint || null;
    const verified = await verifySignedSnapshot(data);
    if (!verified) {
      logSync(`Invalid snapshot signature from ${peerIdToCheck}`, 'warning');
      logAudit(`Invalid snapshot signature`, 'warning', peerIdToCheck, { signerFingerprint });
      adjustReputation(peerIdToCheck, signerFingerprint, -10, 'invalid snapshot signature');
      return;
    }
    const signerOk = await verifySnapshotSigner(data, peerIdToCheck);
    if (!signerOk) {
      logSync(`Snapshot signer mismatch from ${peerIdToCheck}`, 'warning');
      logAudit(`Snapshot signer mismatch`, 'warning', peerIdToCheck, { signerFingerprint });
      adjustReputation(peerIdToCheck, signerFingerprint, -8, 'snapshot signer mismatch');
      return;
    }
    const eventLog = await computeEventLogHash(data.snapshot?.events || [], { allowLooseStart: !!data.snapshot?.meta?.eventLogPartial });
    if (!eventLog.ok) {
      logSync(`Snapshot event chain invalid from ${peerIdToCheck}`, 'warning');
      logAudit(`Snapshot event chain invalid`, 'warning', peerIdToCheck, { signerFingerprint });
      adjustReputation(peerIdToCheck, signerFingerprint, -6, 'snapshot chain invalid');
      return;
    }
    const maxSeq = (data.snapshot?.events || []).reduce((m, e) => Math.max(m, e.seq || 0), 0);
    if (data.snapshot?.meta?.eventSeq && maxSeq > data.snapshot.meta.eventSeq) {
      logSync(`Snapshot event sequence invalid from ${peerIdToCheck}`, 'warning');
      logAudit(`Snapshot event sequence invalid`, 'warning', peerIdToCheck, { signerFingerprint });
      adjustReputation(peerIdToCheck, signerFingerprint, -4, 'snapshot seq invalid');
      return;
    }
    const declaredHash = data.snapshot?.meta?.eventLogHash;
    if (declaredHash && declaredHash !== eventLog.hash) {
      logSync(`Snapshot event log hash mismatch from ${peerIdToCheck}`, 'warning');
      logAudit(`Snapshot event log hash mismatch`, 'warning', peerIdToCheck, { signerFingerprint });
      adjustReputation(peerIdToCheck, signerFingerprint, -4, 'snapshot hash mismatch');
      return;
    }
    if (!declaredHash) {
      logSync(`Snapshot missing event log hash from ${peerIdToCheck}`, 'warning');
      logAudit(`Snapshot missing event log hash`, 'info', peerIdToCheck, { signerFingerprint });
    }
    adjustReputation(peerIdToCheck, signerFingerprint, 2, 'snapshot verified');
    applySnapshot(data.snapshot);
  }, [adjustReputation, applySnapshot, computeEventLogHash, logAudit, logSync, shouldAllowInbound, verifySignedSnapshot, verifySnapshotSigner]);

  const isValidTransition = useCallback((evt, existingTicket) => {
    if (!evt?.type) return false;
    if (evt.type === 'TicketCreated') return !existingTicket;
    if (!existingTicket) return false;
    const status = existingTicket.status;
    if (evt.type === 'TicketAssigned') return ['Open', 'Waiting', 'Escalated'].includes(status);
    if (evt.type === 'TicketEscalated') return ['Open', 'In Progress', 'Waiting'].includes(status);
    if (evt.type === 'TicketResolved') return ['In Progress', 'Escalated', 'Waiting'].includes(status);
    if (evt.type === 'TicketClosed') return ['Resolved'].includes(status);
    if (evt.type === 'TicketReopened') return ['Closed'].includes(status);
    return true;
  }, []);

  const isAuthorizedEvent = useCallback((evt, incomingTicket, existingTicket) => {
    if (!evt) return false;
    if (!isValidTransition(evt, existingTicket)) return false;
    const isSenior = getRoleRank(evt.actorRole) >= getRoleRank('Senior');
    if (evt.type === 'TicketEscalated') return isTrustedElevated(evt.actorFingerprint);
    if (evt.type === 'TicketClosed') {
      if (existingTicket?.status === 'Resolved') {
        return isTrustedElevated(evt.actorFingerprint) || (existingTicket.customerPeerId && existingTicket.customerPeerId === evt.actorPeerId);
      }
      return isTrustedElevated(evt.actorFingerprint);
    }
    if (evt.type === 'TicketReopened') {
      return isTrustedElevated(evt.actorFingerprint) || (existingTicket?.customerPeerId && existingTicket.customerPeerId === evt.actorPeerId);
    }
    if (evt.type === 'TicketResolved') {
      if (incomingTicket?.agentId && incomingTicket.agentId === evt.actorPeerId) return true;
      if (isSenior) return true;
      return isTrustedElevated(evt.actorFingerprint);
    }
    if (evt.type === 'TicketAssigned') {
      return getRoleRank(evt.actorRole) >= getRoleRank('L1');
    }
    return true;
  }, [isTrustedElevated, isValidTransition]);

  const applyEvent = useCallback((evt, ticket) => {
    if (!evt) return;
    if (seenEventsRef.current.has(evt.id)) return;
    seenEventsRef.current.add(evt.id);
    observeLamport(evt.clock || 0);
    eventSeqRef.current = Math.max(eventSeqRef.current, evt.seq || 0);
    suppressBroadcastRef.current = true;
    setState(prev => {
      let tickets = prev.tickets;
      if (ticket) {
        const existing = prev.tickets.find(t => t.id === ticket.id);
        if (!existing) {
          tickets = [ticket, ...prev.tickets];
        } else {
          const aClock = ticket.clock || 0;
          const bClock = existing.clock || 0;
          if (aClock > bClock || (aClock === bClock && new Date(ticket.updated).getTime() >= new Date(existing.updated).getTime())) {
            tickets = prev.tickets.map(t => t.id === ticket.id ? ticket : t);
          }
        }
      }
      const events = [evt, ...prev.events.filter(e => e.id !== evt.id)].slice(0, 200);
      return {
        ...prev,
        tickets,
        events,
        meta: {
          ...prev.meta,
          lamport: Math.max(prev.meta?.lamport || 0, lamportRef.current),
          eventSeq: Math.max(prev.meta?.eventSeq || 0, evt.seq || 0)
        }
      };
    });
    setTimeout(() => { suppressBroadcastRef.current = false; }, 0);
  }, [observeLamport]);

  const handleIncomingEvent = useCallback(async (payload, peerIdToCheck) => {
    if (!payload?.event) return;
    if (!shouldAllowInbound(peerIdToCheck)) return;
    const evt = payload.event;
    const evtLabel = `${evt.type || 'Event'} id=${evt.id || 'unknown'} ticket=${evt.ticketId || 'n/a'} actor=${evt.actor || 'unknown'}`;
    const evtMeta = {
      eventId: evt.id || null,
      ticketId: evt.ticketId || null,
      actor: evt.actor || null,
      actorRole: evt.actorRole || null,
      actorPeerId: evt.actorPeerId || null,
      actorFingerprint: evt.actorFingerprint || null,
      eventType: evt.type || null,
      seq: evt.seq || null
    };
    const verified = await verifySignedEvent(evt);
    if (!verified) {
      logSync(`Invalid signature from ${peerIdToCheck}`, 'warning');
      logAudit(`Invalid event signature (${evtLabel})`, 'warning', peerIdToCheck, evtMeta);
      adjustReputation(peerIdToCheck, evt.actorFingerprint, -8, 'invalid event signature');
      return;
    }
    if (payload.ticket && evt.ticketHash) {
      const computed = await hashPayload(payload.ticket);
      if (computed !== evt.ticketHash) {
        logSync(`Ticket hash mismatch from ${peerIdToCheck}`, 'warning');
        logAudit(`Ticket hash mismatch (${evtLabel})`, 'warning', peerIdToCheck, evtMeta);
        adjustReputation(peerIdToCheck, evt.actorFingerprint, -5, 'ticket hash mismatch');
        return;
      }
    }
    if (evt.chainHash) {
      const prevHash = evt.prevHash || EVENT_CHAIN_GENESIS;
      const expected = await hashPayload({ prevHash, event: getEventChainPayload(evt) });
      if (expected !== evt.chainHash) {
        logSync(`Event chain hash invalid from ${peerIdToCheck}`, 'warning');
        logAudit(`Event chain hash invalid (${evtLabel})`, 'warning', peerIdToCheck, evtMeta);
        adjustReputation(peerIdToCheck, evt.actorFingerprint, -5, 'event chain invalid');
        return;
      }
      const hasPrev = stateRef.current.events.some(e => e.chainHash === prevHash);
      if (evt.prevHash && !hasPrev) {
        logSync(`Event chain link missing from ${peerIdToCheck}`, 'warning');
        logAudit(`Event chain link missing (${evtLabel})`, 'info', peerIdToCheck, evtMeta);
      }
    }
    const existingTicket = payload.ticket ? stateRef.current.tickets.find(t => t.id === payload.ticket.id) : null;
    upsertKnownPeer({
      peerId: evt.actorPeerId,
      displayName: evt.actor,
      role: evt.actorRole,
      publicKeyFingerprint: evt.actorFingerprint,
      publicKeyJwk: evt.actorPublicKeyJwk
    });
    if (!isAuthorizedEvent(evt, payload.ticket, existingTicket)) {
      logSync(`Unauthorized event blocked from ${peerIdToCheck}`, 'warning');
      logAudit(`Unauthorized event blocked (${evtLabel})`, 'warning', peerIdToCheck, evtMeta);
      adjustReputation(peerIdToCheck, evt.actorFingerprint, -6, 'unauthorized event');
      return;
    }
    adjustReputation(peerIdToCheck, evt.actorFingerprint, 1, 'event verified');
    applyEvent(evt, payload.ticket);
  }, [adjustReputation, applyEvent, getEventChainPayload, isAuthorizedEvent, logAudit, logSync, shouldAllowInbound, upsertKnownPeer, verifySignedEvent]);

  const emitEvent = useCallback(async (event, ticket) => {
    if (!event) return;
    seenEventsRef.current.add(event.id);
    const payload = { type: 'event', event, ticket };
    const sent = sendToOpenConnections(payload);
    if (sent === 0) enqueueOutbound(payload, 'offline');
    // Fallback to full snapshot to keep peers consistent if an event is dropped.
    sendSnapshotToAll();
  }, [enqueueOutbound, sendSnapshotToAll, sendToOpenConnections]);

  const setupConnection = useCallback((conn) => {
    connsRef.current.set(conn.peer, conn);
    updateConnectionsState();
    logSync(`Connected to ${conn.peer}`);

    const handleOpen = () => {
      updateConnectionsState();
      logSync(`Connection open with ${conn.peer}`);
      void sendHello(conn);
      void sendSnapshot(conn);
      setTimeout(() => flushOutbox('connect'), 150);
    };
    conn.on('open', handleOpen);
    conn.on('data', (data) => {
      if (!data || !data.type) return;
      if (data.type === 'hello') {
        if (data.identity && data.sig) {
          void (async () => {
            const verified = await verifySignedIdentity(data.identity, data.sig);
            if (verified) {
              const powCfg = settings.security?.pow || { enabled: false, difficulty: 3 };
              const isTrusted = settings.security?.trustedElevated?.includes(data.identity.publicKeyFingerprint);
              const known = knownPeersRef.current.get(data.identity.publicKeyFingerprint);
              if (powCfg.enabled && !isTrusted && !known) {
                const ok = await verifyPowToken(data.pow, data.identity.peerId, data.identity.publicKeyFingerprint, powCfg.difficulty);
                if (!ok) {
                  logSync(`PoW rejected from ${conn.peer}`, 'warning');
                  logAudit('PoW rejected', 'warning', conn.peer, { eventType: 'PoW', signerFingerprint: data.identity.publicKeyFingerprint });
                  try { conn.close(); } catch (e) {}
                  return;
                }
              }
              upsertKnownPeer(data.identity);
              logSync(`Hello from ${data.identity.displayName || conn.peer}`);
            } else {
              logSync(`Unverified hello from ${conn.peer}`, 'warning');
            }
          })();
        } else {
          logSync(`Hello from ${conn.peer}`);
        }
        void sendSnapshot(conn);
      }
      if (data.type === 'ping') {
        logSync(`Ping from ${conn.peer}`);
        try { conn.send({ type: 'pong', ts: Date.now() }); } catch (e) {}
      }
      if (data.type === 'pong') {
        logSync(`Pong from ${conn.peer}`);
      }
      if (data.type === 'req_snapshot') {
        logSync(`Snapshot requested by ${conn.peer}`);
        void sendSnapshot(conn);
      }
      if (data.type === 'req_peer_list') {
        logSync(`Peer list requested by ${conn.peer}`);
        void sendPeerListToConn(conn);
      }
      if (data.type === 'snapshot') {
        void (async () => {
          await handleIncomingSnapshot(data, conn.peer);
          logSync(`Snapshot synced with ${conn.peer}`);
        })();
        setGossipRound(prev => prev + 1);
      }
      if (data.type === 'snapshot_compressed') {
        void (async () => {
          const decompressed = await decompressJson(data.data);
          if (!decompressed.ok) {
            logSync(`Snapshot decompress failed from ${conn.peer}`, 'warning');
            logAudit('Snapshot decompress failed', 'warning', conn.peer, { eventType: 'Snapshot' });
            return;
          }
          await handleIncomingSnapshot(decompressed.data, conn.peer);
          logSync(`Snapshot (compressed) synced with ${conn.peer}`);
        })();
        setGossipRound(prev => prev + 1);
      }
      if (data.type === 'peer_list') {
        void (async () => {
          const ok = await verifyPayload(data?.signer?.publicKeyJwk, { peers: data.peers, signer: data.signer }, data.sig);
          if (!ok) {
            logAudit('Peer list signature invalid', 'warning', conn.peer, { eventType: 'PeerDiscovery', signerFingerprint: data?.signer?.fingerprint || null });
            return;
          }
          const computed = await fingerprintFromPublicJwk(data?.signer?.publicKeyJwk);
          if (!computed || computed !== data?.signer?.fingerprint) {
            logAudit('Peer list signer mismatch', 'warning', conn.peer, { eventType: 'PeerDiscovery', signerFingerprint: data?.signer?.fingerprint || null });
            return;
          }
          (data.peers || []).forEach(p => upsertKnownPeer(p));
          logSync(`Peer list received from ${conn.peer}`);
          logAudit('Peer list received', 'info', conn.peer, { eventType: 'PeerDiscovery', signerFingerprint: data?.signer?.fingerprint || null });
        })();
      }
      if (data.type === 'policy') {
        void (async () => {
          const ok = await verifyPolicyEnvelope(data);
          if (!ok) {
            logSync(`Policy signature invalid from ${conn.peer}`, 'warning');
            logAudit('Invalid policy signature', 'warning', conn.peer, { eventType: 'PolicySync', signerFingerprint: data?.signer?.fingerprint || null });
            return;
          }
          setPendingPolicies(prev => {
            const exists = prev.some(p => p.signer?.fingerprint === data.signer?.fingerprint && stableStringify(p.policy) === stableStringify(data.policy));
            if (exists) return prev;
            return [{ id: genId(), ts: new Date().toISOString(), policy: data.policy, signer: data.signer, sig: data.sig }, ...prev].slice(0, 50);
          });
          logSync(`Policy proposal received from ${conn.peer}`);
          logAudit('Policy proposal received', 'info', conn.peer, { eventType: 'PolicySync', signerFingerprint: data?.signer?.fingerprint || null });
        })();
      }
      if (data.type === 'peer_vote') {
        void (async () => {
          const payload = data.payload;
          if (!payload?.voterFingerprint || !payload?.targetPeerId) return;
          const verified = await verifyPayload(payload?.voterPublicKeyJwk, payload, data.sig);
          if (!verified) {
            logAudit('Invalid peer vote signature', 'warning', conn.peer, { eventType: 'PeerVoteMuted' });
            return;
          }
          const computed = await fingerprintFromPublicJwk(payload.voterPublicKeyJwk);
          if (!computed || computed !== payload.voterFingerprint) {
            logAudit('Peer vote fingerprint mismatch', 'warning', conn.peer, { eventType: 'PeerVoteMuted' });
            return;
          }
          recordVote(payload);
          logSync(`Peer vote received for ${payload.targetPeerId}`);
        })();
      }
      if (data.type === 'event') {
        void (async () => {
          await handleIncomingEvent(data, conn.peer);
          logSync(`Event synced with ${conn.peer}`);
        })();
        setGossipRound(prev => prev + 1);
      }
    });
    conn.on('close', () => {
      connsRef.current.delete(conn.peer);
      updateConnectionsState();
      logSync(`Disconnected from ${conn.peer}`, 'warning');
    });
    conn.on('error', (err) => {
      const detail = err?.type || err?.message || 'unknown';
      logSync(`Connection error with ${conn.peer}: ${detail}`, 'error');
    });
    if (conn.peerConnection) {
      const pc = conn.peerConnection;
      const logIceState = () => logSync(`ICE ${conn.peer}: ${pc.iceConnectionState}`);
      try {
        logIceState();
        pc.addEventListener('iceconnectionstatechange', logIceState);
      } catch (e) {}
    }
    if (conn.open) handleOpen();
  }, [flushOutbox, handleIncomingEvent, handleIncomingSnapshot, logAudit, logSync, sendHello, sendPeerListToConn, sendSnapshot, settings.security, updateConnectionsState, upsertKnownPeer, verifySignedIdentity]);

  useEffect(() => { setupConnectionRef.current = setupConnection; }, [setupConnection]);
  useEffect(() => { logSyncRef.current = logSync; }, [logSync]);
  useEffect(() => { updateConnectionsStateRef.current = updateConnectionsState; }, [updateConnectionsState]);
  useEffect(() => {
    if (!outbox.length) return;
    if (!connections.some(c => c.open)) return;
    const timer = setTimeout(() => flushOutbox('auto'), 800);
    return () => clearTimeout(timer);
  }, [connections, flushOutbox, outbox.length]);

  const connectToPeer = useCallback(() => {
    if (!peerRef.current || !connectTarget.trim()) return;
    if (connsRef.current.has(connectTarget.trim())) return;
    try {
      const conn = peerRef.current.connect(connectTarget.trim(), { reliable: true });
      setupConnection(conn);
      setConnectTarget('');
    } catch (e) {
      logSync(`Failed to connect to ${connectTarget.trim()}`, 'error');
    }
  }, [connectTarget, logSync, setupConnection]);

  const disconnectPeer = useCallback((peerIdToClose) => {
    const conn = connsRef.current.get(peerIdToClose);
    if (!conn) return;
    try { conn.close(); } catch (e) {}
    connsRef.current.delete(peerIdToClose);
    updateConnectionsState();
    logSync(`Disconnected from ${peerIdToClose}`, 'warning');
  }, [logSync, updateConnectionsState]);

  const reconnectPeerJS = useCallback(() => {
    try {
      if (peerRef.current) peerRef.current.destroy();
    } catch (e) {}
    peerRef.current = null;
    connsRef.current.clear();
    updateConnectionsState();
    setPeerRestartNonce(n => n + 1);
    logSync('Reconnecting PeerJS...');
  }, [logSync, updateConnectionsState]);

  const requestSnapshotFromPeer = useCallback((peerIdToRequest) => {
    const conn = connsRef.current.get(peerIdToRequest);
    if (!conn || !conn.open) {
      logSync(`Cannot request snapshot from ${peerIdToRequest}`, 'warning');
      return;
    }
    try {
      conn.send({ type: 'req_snapshot' });
      logSync(`Snapshot requested from ${peerIdToRequest}`);
    } catch (e) {
      logSync(`Snapshot request failed to ${peerIdToRequest}`, 'error');
    }
  }, [logSync]);

  const pingPeer = useCallback((peerIdToPing) => {
    const conn = connsRef.current.get(peerIdToPing);
    if (!conn || !conn.open) {
      logSync(`Cannot ping ${peerIdToPing}`, 'warning');
      return;
    }
    try {
      conn.send({ type: 'ping', ts: Date.now() });
      logSync(`Ping sent to ${peerIdToPing}`);
    } catch (e) {
      logSync(`Ping failed to ${peerIdToPing}`, 'error');
    }
  }, [logSync]);

  // PeerJS lifecycle
  useEffect(() => {
    const activeIdentity = identityRef.current;
    if (!activeIdentity) return;
    peerLifecycleRef.current += 1;
    const lifecycleId = peerLifecycleRef.current;
    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch (e) {}
      peerRef.current = null;
      connsRef.current.clear();
      updateConnectionsStateRef.current?.();
    }
    setPeerStatus('connecting');
    setNetworkStatus('syncing');
    const server = settings?.peerServer || {};
    const turn = settings?.turn || {};
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (turn.enabled && turn.host) {
      const turnUrl = `${turn.useTLS ? 'turns' : 'turn'}:${turn.host}:${turn.port}`;
      iceServers.push({ urls: turnUrl, username: turn.username, credential: turn.credential });
    }
    let peer;
    try {
      if (server.useCustom) {
        peer = new Peer(activeIdentity.peerId, {
          debug: 1,
          host: server.host,
          port: Number(server.port),
          path: server.path,
          secure: !!server.secure,
          config: { iceServers }
        });
      } else {
        peer = new Peer(activeIdentity.peerId, { debug: 1, config: { iceServers } });
      }
    } catch (e) {
      setPeerStatus('error');
      logSync('Failed to initialize PeerJS', 'error');
      return;
    }
    peerRef.current = peer;
    logSyncRef.current?.(`PeerJS init #${lifecycleId} (peerId=${activeIdentity.peerId})`);

    peer.on('open', (id) => {
      setPeerStatus('online');
      setPeerId(id);
      const latest = identityRef.current || activeIdentity;
      if (latest?.peerId !== id) {
        const updated = { ...latest, peerId: id };
        setIdentity(updated);
        saveIdentity(updated);
      }
      updateConnectionsStateRef.current?.();
      logSyncRef.current?.(`Peer ready: ${id}`);
    });
    peer.on('connection', (conn) => {
      setupConnectionRef.current?.(conn);
    });
    peer.on('disconnected', () => {
      setPeerStatus('offline');
      setNetworkStatus('idle');
      logSyncRef.current?.(`PeerJS disconnected #${lifecycleId}`, 'warning');
    });
    peer.on('close', () => {
      setPeerStatus('offline');
      setNetworkStatus('idle');
      logSyncRef.current?.(`PeerJS closed #${lifecycleId}`, 'warning');
    });
    peer.on('error', (err) => {
      setPeerStatus('error');
      logSyncRef.current?.(`Peer error: ${err?.type || 'unknown'} ${err?.message || ''}`.trim(), 'error');
      if (err?.type === 'unavailable-id') {
        const newId = genId();
        const latest = identityRef.current || activeIdentity;
        const updated = { ...latest, peerId: newId };
        setIdentity(updated);
        saveIdentity(updated);
      }
    });

    return () => {
      logSyncRef.current?.(`PeerJS cleanup #${lifecycleId}`, 'warning');
      try { peer.destroy(); } catch (e) {}
      peerRef.current = null;
      connsRef.current.clear();
      updateConnectionsStateRef.current?.();
    };
  }, [identity?.peerId, settings?.peerServer, settings?.turn, peerRestartNonce]);

  const isCustomer = identity?.role === 'Customer';
  const slaConfig = settings?.sla || {};
  const getSlaTargetMins = useCallback((priority) => {
    const map = slaConfig.targetsMins || {};
    return map[priority] || map.Medium || 240;
  }, [slaConfig.targetsMins]);
  const buildSlaForTicket = useCallback((startIso, priority) => {
    const dueAt = addMinutes(startIso, getSlaTargetMins(priority));
    return {
      startedAt: startIso,
      dueAt,
      breachedAt: null,
      supervisorAlertAt: null,
      resolvedAt: null,
      closedAt: null,
      lastAutoEscalatedAt: null
    };
  }, [getSlaTargetMins]);
  const getNextEscalationLevel = useCallback((level) => {
    if (level === 'L1') return 'L2';
    if (level === 'L2') return 'Senior';
    if (level === 'Senior') return 'Supervisor';
    return 'Supervisor';
  }, []);

  const handleCreateTicket = async (ticket) => {
    const now = new Date().toISOString();
    const customerName = isCustomer ? identity.displayName : ticket.customer;
    const clock = bumpLamport();
    const seq = bumpEventSeq();
    const newTicket = {
      id: genTicketId(),
      subject: ticket.subject,
      customer: customerName,
      customerPeerId: isCustomer ? identity.peerId : null,
      customerAvatar: genAvatar(customerName),
      agent: null,
      agentId: null,
      status: 'Open',
      priority: ticket.priority,
      category: ticket.category,
      escalationLevel: 'L1',
      messages: [{ id: genId(), type: 'customer', sender: customerName, text: ticket.message, ts: now }],
      created: now,
      updated: now,
      sla: buildSlaForTicket(now, ticket.priority),
      clock,
      updatedByFingerprint: identity?.publicKeyFingerprint || null,
      updatedByPeerId: identity?.peerId || null,
      replicationCount: 1,
      tags: [],
      acl: {
        mode: 'public',
        roles: ['Customer', 'L1', 'L2', 'Senior', 'Supervisor'],
        peers: [isCustomer ? identity.peerId : null].filter(Boolean),
        fingerprints: []
      }
    };
    const ticketHash = await hashPayload(newTicket);
    const evtBase = { id: genId(), type: 'TicketCreated', ticketId: newTicket.id, actor: customerName, ts: now, detail: ticket.subject, clock, seq, ticketHash };
    const evt = await createSignedEvent(evtBase);
    if (!evt) return;
    setState(prev => ({
      ...prev,
      tickets: [newTicket, ...prev.tickets],
      events: [evt, ...prev.events],
      meta: { ...prev.meta, lamport: clock, eventSeq: seq }
    }));
    await emitEvent(evt, newTicket);
    setShowCreateModal(false);
  };

  const handleStartAgentChat = async (agent) => {
    if (!identity || identity.role === 'Customer') return;
    if (!agent || agent.peerId === identity.peerId) return;
    const now = new Date().toISOString();
    const clock = bumpLamport();
    const seq = bumpEventSeq();
    const subject = `Internal chat: ${identity.displayName} → ${agent.name}`;
    const msg = {
      id: genId(),
      type: 'agent',
      sender: identity.displayName,
      text: `Started chat with ${agent.name}.`,
      ts: now,
      clock,
      seq,
      senderFingerprint: identity.publicKeyFingerprint,
      senderPeerId: identity.peerId
    };
    const newTicket = {
      id: genTicketId(),
      subject,
      customer: identity.displayName,
      customerPeerId: identity.peerId,
      customerAvatar: genAvatar(identity.displayName),
      agent: agent.name,
      agentId: agent.peerId,
      status: 'In Progress',
      priority: 'Low',
      category: 'General',
      escalationLevel: 'L1',
      messages: [msg],
      created: now,
      updated: now,
      clock,
      updatedByFingerprint: identity.publicKeyFingerprint,
      updatedByPeerId: identity.peerId,
      replicationCount: 1,
      tags: ['internal-chat']
    };
    const ticketHash = await hashPayload(newTicket);
    const evtBase = { id: genId(), type: 'TicketCreated', ticketId: newTicket.id, actor: identity.displayName, ts: now, detail: subject, clock, seq, ticketHash };
    const evt = await createSignedEvent(evtBase);
    if (!evt) return;
    setState(prev => ({
      ...prev,
      tickets: [newTicket, ...prev.tickets],
      events: [evt, ...prev.events],
      meta: { ...prev.meta, lamport: clock, eventSeq: seq }
    }));
    await emitEvent(evt, newTicket);
    setSelectedTicketId(newTicket.id);
    setView('chat');
  };

  const handleClaimTicket = async (ticketId) => {
    if (!identity) return;
    if (identity.role === 'Customer') return;
    const now = new Date().toISOString();
    const base = stateRef.current.tickets.find(t => t.id === ticketId);
    if (!base) return;
    if (!isValidTransition({ type: 'TicketAssigned' }, base)) return;
    const clock = bumpLamport();
    const seq = bumpEventSeq();
    const updatedTicket = {
      ...base,
      agent: identity.displayName,
      agentId: identity.peerId,
      status: 'In Progress',
      updated: now,
      clock,
      updatedByFingerprint: identity.publicKeyFingerprint,
      updatedByPeerId: identity.peerId
    };
    const ticketHash = await hashPayload(updatedTicket);
    const evtBase = { id: genId(), type: 'TicketAssigned', ticketId, actor: identity.displayName, ts: now, detail: `Claimed by ${identity.displayName}`, clock, seq, ticketHash };
    const evt = await createSignedEvent(evtBase);
    if (!evt) return;
    setState(prev => ({
      ...prev,
      tickets: prev.tickets.map(t => t.id === ticketId ? updatedTicket : t),
      events: [evt, ...prev.events],
      meta: { ...prev.meta, lamport: clock, eventSeq: seq }
    }));
    await emitEvent(evt, updatedTicket);
  };

  const handleEscalateTicket = async (ticketId) => {
    if (!identity || !isTrustedElevated(identity.publicKeyFingerprint)) return;
    const now = new Date().toISOString();
    const base = stateRef.current.tickets.find(t => t.id === ticketId);
    if (!base) return;
    if (!isValidTransition({ type: 'TicketEscalated' }, base)) return;
    const currentLevelIdx = ROLES.indexOf(base.escalationLevel || 'L1');
    const nextLevel = ROLES[Math.min(currentLevelIdx + 1, ROLES.length - 1)];
    const clock = bumpLamport();
    const seq = bumpEventSeq();
    const updatedTicket = {
      ...base,
      status: 'Escalated',
      escalationLevel: nextLevel,
      updated: now,
      clock,
      updatedByFingerprint: identity.publicKeyFingerprint,
      updatedByPeerId: identity.peerId
    };
    const ticketHash = await hashPayload(updatedTicket);
    const evtBase = { id: genId(), type: 'TicketEscalated', ticketId, actor: identity?.displayName || 'System', ts: now, detail: `Escalated to ${nextLevel}`, clock, seq, ticketHash };
    const evt = await createSignedEvent(evtBase);
    if (!evt) return;
    setState(prev => {
      return {
        ...prev,
        tickets: prev.tickets.map(t => t.id === ticketId ? updatedTicket : t),
        events: [evt, ...prev.events],
        meta: { ...prev.meta, lamport: clock, eventSeq: seq }
      };
    });
    await emitEvent(evt, updatedTicket);
  };

  const handleResolveTicket = async (ticketId) => {
    const now = new Date().toISOString();
    const base = stateRef.current.tickets.find(t => t.id === ticketId);
    if (!base) return;
    if (!isValidTransition({ type: 'TicketResolved' }, base)) return;
    if (identity && base.agentId && base.agentId !== identity.peerId && !isTrustedElevated(identity.publicKeyFingerprint)) return;
    const clock = bumpLamport();
    const seq = bumpEventSeq();
    const updatedTicket = {
      ...base,
      status: 'Resolved',
      updated: now,
      sla: {
        ...(base.sla || buildSlaForTicket(base.created, base.priority)),
        resolvedAt: now
      },
      clock,
      updatedByFingerprint: identity?.publicKeyFingerprint || null,
      updatedByPeerId: identity?.peerId || null
    };
    const ticketHash = await hashPayload(updatedTicket);
    const evtBase = { id: genId(), type: 'TicketResolved', ticketId, actor: identity?.displayName || 'System', ts: now, detail: 'Ticket resolved', clock, seq, ticketHash };
    const evt = await createSignedEvent(evtBase);
    if (!evt) return;
    setState(prev => ({
      ...prev,
      tickets: prev.tickets.map(t => t.id === ticketId ? updatedTicket : t),
      events: [evt, ...prev.events],
      meta: { ...prev.meta, lamport: clock, eventSeq: seq }
    }));
    await emitEvent(evt, updatedTicket);
  };

  const handleCloseTicket = async (ticketId) => {
    if (!identity) return;
    const now = new Date().toISOString();
    const base = stateRef.current.tickets.find(t => t.id === ticketId);
    if (!base || base.status === 'Closed') return;
    const isOwner = identity.role === 'Customer' && base.customerPeerId === identity.peerId;
    const isElevated = isTrustedElevated(identity.publicKeyFingerprint);
    if (base.status === 'Resolved') {
      if (!isOwner && !isElevated) return;
    } else {
      if (!isElevated) return;
    }
    if (!isValidTransition({ type: 'TicketClosed' }, base)) return;
    const clock = bumpLamport();
    const seq = bumpEventSeq();
    const updatedTicket = {
      ...base,
      status: 'Closed',
      updated: now,
      sla: {
        ...(base.sla || buildSlaForTicket(base.created, base.priority)),
        closedAt: now
      },
      clock,
      updatedByFingerprint: identity.publicKeyFingerprint,
      updatedByPeerId: identity.peerId
    };
    const ticketHash = await hashPayload(updatedTicket);
    const evtBase = { id: genId(), type: 'TicketClosed', ticketId, actor: identity.displayName, ts: now, detail: 'Ticket closed', clock, seq, ticketHash };
    const evt = await createSignedEvent(evtBase);
    if (!evt) return;
    setState(prev => ({
      ...prev,
      tickets: prev.tickets.map(t => t.id === ticketId ? updatedTicket : t),
      events: [evt, ...prev.events],
      meta: { ...prev.meta, lamport: clock, eventSeq: seq }
    }));
    await emitEvent(evt, updatedTicket);
  };

  const handleReopenTicket = async (ticketId) => {
    if (!identity) return;
    const now = new Date().toISOString();
    const base = stateRef.current.tickets.find(t => t.id === ticketId);
    if (!base || base.status !== 'Closed') return;
    const isOwner = identity.role === 'Customer' && base.customerPeerId === identity.peerId;
    const isElevated = isTrustedElevated(identity.publicKeyFingerprint);
    if (!isOwner && !isElevated) return;
    if (!isValidTransition({ type: 'TicketReopened' }, base)) return;
    const clock = bumpLamport();
    const seq = bumpEventSeq();
    const updatedTicket = {
      ...base,
      status: 'Open',
      updated: now,
      sla: buildSlaForTicket(now, base.priority),
      clock,
      updatedByFingerprint: identity.publicKeyFingerprint,
      updatedByPeerId: identity.peerId
    };
    const ticketHash = await hashPayload(updatedTicket);
    const evtBase = { id: genId(), type: 'TicketReopened', ticketId, actor: identity.displayName, ts: now, detail: 'Ticket reopened', clock, seq, ticketHash };
    const evt = await createSignedEvent(evtBase);
    if (!evt) return;
    setState(prev => ({
      ...prev,
      tickets: prev.tickets.map(t => t.id === ticketId ? updatedTicket : t),
      events: [evt, ...prev.events],
      meta: { ...prev.meta, lamport: clock, eventSeq: seq }
    }));
    await emitEvent(evt, updatedTicket);
  };

  const applyAutomatedTicketUpdate = useCallback(async (base, changes, eventType, detail) => {
    if (!base) return null;
    if (!identity?.privateKeyJwk) return null;
    const now = new Date().toISOString();
    const clock = bumpLamport();
    const seq = bumpEventSeq();
    const updatedTicket = {
      ...base,
      ...changes,
      updated: now,
      clock,
      updatedByFingerprint: identity?.publicKeyFingerprint || base.updatedByFingerprint || null,
      updatedByPeerId: identity?.peerId || base.updatedByPeerId || null
    };
    const ticketHash = await hashPayload(updatedTicket);
    const evtBase = { id: genId(), type: eventType, ticketId: base.id, actor: identity?.displayName || 'System', ts: now, detail, clock, seq, ticketHash };
    const evt = await createSignedEvent(evtBase);
    if (!evt) return null;
    setState(prev => ({
      ...prev,
      tickets: prev.tickets.map(t => t.id === base.id ? updatedTicket : t),
      events: [evt, ...prev.events],
      meta: { ...prev.meta, lamport: clock, eventSeq: seq }
    }));
    await emitEvent(evt, updatedTicket);
    return updatedTicket;
  }, [bumpEventSeq, bumpLamport, createSignedEvent, emitEvent, identity]);

  useEffect(() => {
    if (!slaConfig?.enabled) return;
    const timer = setInterval(() => {
      void (async () => {
        if (!identity?.privateKeyJwk) return;
        const tickets = stateRef.current.tickets || [];
        const nowIso = new Date().toISOString();
        for (const baseTicket of tickets) {
          if (!baseTicket) continue;
          if (['Resolved', 'Closed'].includes(baseTicket.status)) continue;
          let working = baseTicket;
          let sla = working.sla || buildSlaForTicket(working.created, working.priority);

          // Auto-escalate Critical immediately
          if (slaConfig.autoEscalateCritical && working.priority === 'Critical' && working.escalationLevel === 'L1' && working.status !== 'Escalated') {
            if (!identity?.publicKeyFingerprint || !isTrustedElevated(identity.publicKeyFingerprint)) {
              logAudit('Auto-escalation blocked (not trusted)', 'warning', identity?.peerId || null, { ticketId: working.id, eventType: 'TicketEscalated' });
            } else {
              const next = getNextEscalationLevel(working.escalationLevel);
              const updated = await applyAutomatedTicketUpdate(
                working,
                {
                  status: 'Escalated',
                  escalationLevel: next,
                  sla: { ...sla, lastAutoEscalatedAt: nowIso }
                },
                'TicketEscalated',
                'Auto-escalated: Critical priority'
              );
              if (updated) {
                working = updated;
                sla = updated.sla || sla;
              }
            }
          }

          // Auto-escalate if unassigned too long
          if (slaConfig.autoEscalateAfterMins > 0 && !working.agentId && minutesSince(working.created) >= slaConfig.autoEscalateAfterMins && working.status !== 'Escalated') {
            if (!identity?.publicKeyFingerprint || !isTrustedElevated(identity.publicKeyFingerprint)) {
              logAudit('Auto-escalation blocked (not trusted)', 'warning', identity?.peerId || null, { ticketId: working.id, eventType: 'TicketEscalated' });
            } else {
              const next = getNextEscalationLevel(working.escalationLevel);
              const updated = await applyAutomatedTicketUpdate(
                working,
                {
                  status: 'Escalated',
                  escalationLevel: next,
                  sla: { ...sla, lastAutoEscalatedAt: nowIso }
                },
                'TicketEscalated',
                `Auto-escalated: Unassigned for ${slaConfig.autoEscalateAfterMins}m`
              );
              if (updated) {
                working = updated;
                sla = updated.sla || sla;
              }
            }
          }

          // SLA breach
          if (!sla.breachedAt && sla.dueAt && new Date(nowIso).getTime() >= new Date(sla.dueAt).getTime()) {
            const updated = await applyAutomatedTicketUpdate(
              working,
              { sla: { ...sla, breachedAt: nowIso } },
              'SlaBreached',
              `SLA breached (due ${new Date(sla.dueAt).toLocaleString()})`
            );
            if (updated) {
              working = updated;
              sla = updated.sla || sla;
            }
          }

          // Supervisor alert
          if (slaConfig.supervisorAlertAfterMins > 0 && !sla.supervisorAlertAt && minutesSince(working.created) >= slaConfig.supervisorAlertAfterMins) {
            const updated = await applyAutomatedTicketUpdate(
              working,
              { sla: { ...sla, supervisorAlertAt: nowIso } },
              'SupervisorAlerted',
              `Supervisor alert after ${slaConfig.supervisorAlertAfterMins}m unresolved`
            );
            if (updated) {
              working = updated;
              sla = updated.sla || sla;
            }
          }
        }
      })();
    }, 15000);
    return () => clearInterval(timer);
  }, [applyAutomatedTicketUpdate, buildSlaForTicket, getNextEscalationLevel, identity?.peerId, identity?.privateKeyJwk, identity?.publicKeyFingerprint, logAudit, slaConfig]);

  const handleSendMessage = async (ticketId, text) => {
    if (!text.trim()) return;
    const now = new Date().toISOString();
    const isCustomerSender = identity?.role === 'Customer';
    const clock = bumpLamport();
    const seq = bumpEventSeq();
    const msg = {
      id: genId(),
      type: isCustomerSender ? 'customer' : 'agent',
      sender: identity?.displayName || 'You',
      text,
      ts: now,
      clock,
      seq,
      senderFingerprint: identity?.publicKeyFingerprint || null,
      senderPeerId: identity?.peerId || null
    };
    const base = stateRef.current.tickets.find(t => t.id === ticketId);
    if (!base) return;
    const updatedTicket = {
      ...base,
      messages: [...base.messages, msg],
      updated: now,
      clock,
      updatedByFingerprint: identity?.publicKeyFingerprint || null,
      updatedByPeerId: identity?.peerId || null
    };
    const ticketHash = await hashPayload(updatedTicket);
    const evtBase = { id: genId(), type: 'MessageSent', ticketId, actor: identity?.displayName || 'You', ts: now, detail: text.substring(0, 60), clock, seq, ticketHash };
    const evt = await createSignedEvent(evtBase);
    if (!evt) return;
    setState(prev => ({
      ...prev,
      tickets: prev.tickets.map(t => t.id === ticketId ? updatedTicket : t),
      events: [evt, ...prev.events],
      meta: { ...prev.meta, lamport: clock, eventSeq: seq }
    }));
    await emitEvent(evt, updatedTicket);
  };

  const agentsList = useMemo(() => {
    const list = [];
    if (identity) {
      list.push({
        id: identity.peerId,
        name: identity.displayName,
        role: identity.role,
        status: 'Online',
        avatar: '#6366F1',
        peerId: identity.peerId
      });
    }
    connections.forEach((c, i) => {
      const known = knownPeersById.get(c.peerId);
      const displayName = known?.displayName || `Peer ${i + 1}`;
      const role = known?.role || 'L1';
      list.push({
        id: c.peerId,
        name: displayName,
        role,
        status: c.open ? 'Online' : 'Offline',
        avatar: genAvatar(displayName || c.peerId),
        peerId: c.peerId,
        fingerprint: known?.publicKeyFingerprint || null
      });
    });
    return list;
  }, [connections, identity, knownPeersById]);

  const canViewTicket = useCallback((ticket, viewer) => {
    if (!ticket || !viewer) return true;
    const acl = ticket.acl;
    if (!acl || acl.mode !== 'restricted') return true;
    if (acl.peers?.includes(viewer.peerId)) return true;
    if (acl.fingerprints?.includes(viewer.publicKeyFingerprint)) return true;
    if (acl.roles?.includes(viewer.role)) return true;
    return false;
  }, []);

  const visibleTickets = useMemo(() => {
    if (!identity) return state.tickets;
    if (identity.role === 'Customer') {
      return state.tickets.filter(t => t.customerPeerId === identity.peerId).filter(t => canViewTicket(t, identity));
    }
    return state.tickets.filter(t => canViewTicket(t, identity));
  }, [canViewTicket, identity, state.tickets]);

  const metrics = useMemo(() => {
    const openTickets = visibleTickets.filter(t => ['Open', 'In Progress', 'Waiting', 'Escalated'].includes(t.status)).length;
    const agentsOnline = agentsList.filter(a => a.status === 'Online').length;
    return {
      openTickets,
      avgResponse: 0,
      agentsOnline,
      escalationsActive: visibleTickets.filter(t => t.status === 'Escalated').length
    };
  }, [agentsList, visibleTickets]);

  const filteredTickets = useMemo(() => {
    return visibleTickets.filter(t => {
      if (filterStatus !== 'All' && t.status !== filterStatus) return false;
      if (filterPriority !== 'All' && t.priority !== filterPriority) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return t.id.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q) || t.customer.toLowerCase().includes(q);
      }
      return true;
    }).sort((a, b) => new Date(b.updated) - new Date(a.updated));
  }, [visibleTickets, filterStatus, filterPriority, searchQuery]);

  const auditAlerts = useMemo(() => auditLog.filter(e => e.level !== 'info').length, [auditLog]);

  // Onboarding Modal
  if (showOnboarding) {
    return h(ToastProvider, null, h(OnboardingModal, { onComplete: handleCreateIdentity, isDark }));
  }

  const navItems = [
    { id: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
    { id: 'tickets', icon: 'ticket', label: 'Ticket Queue', badge: metrics.openTickets },
    { id: 'chat', icon: 'chat', label: 'Live Chat' },
    { id: 'agents', icon: 'users', label: 'Agents' },
    { id: 'escalations', icon: 'escalation', label: 'Escalations', badge: metrics.escalationsActive, badgeColor: 'red' },
    { id: 'network', icon: 'network', label: 'Network' },
    { id: 'audit', icon: 'audit', label: 'Audit', badge: auditAlerts, badgeColor: 'red' },
    { id: 'settings', icon: 'settings', label: 'Settings' },
  ];

  return h(ToastProvider, null,
    h('div', { className: `h-screen w-screen flex ${isDark ? 'dark bg-slate-900 text-slate-100' : 'bg-slate-50 text-slate-900'}` },
      // Sidebar
      h('aside', {
        className: `sidebar-transition flex-shrink-0 flex flex-col ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-900 text-white'} border-r border-white/5 h-screen overflow-hidden`,
        style: { width: sidebarOpen ? 256 : 64, minWidth: sidebarOpen ? 256 : 64 }
      },
        // Logo area
        h('div', { className: 'px-4 py-4 flex items-center gap-3 border-b border-white/5 flex-shrink-0' },
          h('button', {
            onClick: () => setSidebarOpen(p => !p),
            className: 'w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center flex-shrink-0 hover:bg-brand-600 transition-colors'
          },
            h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'white', strokeWidth: 2 },
              h('path', { d: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9' })
            )
          ),
          sidebarOpen && h('div', { className: 'flex items-center gap-2 animate-fade-in' },
            h('span', { className: 'font-semibold text-white text-base tracking-tight' }, 'MeshDesk'),
            h('span', {
              className: `w-2 h-2 rounded-full animate-pulse-dot flex-shrink-0`,
              style: { backgroundColor: networkStatus === 'connected' ? '#10B981' : networkStatus === 'syncing' ? '#F59E0B' : '#EF4444' }
            })
          )
        ),
        // Nav items
        h('nav', { className: 'flex-1 py-2 overflow-y-auto' },
          navItems.map(item =>
            h('button', {
              key: item.id,
              onClick: () => { setView(item.id); setSelectedTicketId(null); },
              
              className: `w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-all relative group ${
                view === item.id ? 'text-white bg-white/8' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`,
              title: item.label
            },
              view === item.id && h('div', { className: 'absolute left-0 top-1 bottom-1 w-0.5 bg-brand-500 rounded-r' }),
              h('span', { className: 'flex-shrink-0 w-5 flex justify-center' }, h(Icon, { name: item.icon, size: 18 })),
              sidebarOpen && h('span', { className: 'truncate animate-fade-in' }, item.label),
              sidebarOpen && item.badge > 0 && h('span', {
                className: `ml-auto text-xs px-1.5 py-0.5 rounded-full font-medium ${
                  item.badgeColor === 'red' ? 'bg-red-500/20 text-red-400' : 'bg-brand-500/20 text-brand-300'
                }`
              }, item.badge)
            )
          )
        ),
        // User card
        identity && h('div', { className: 'border-t border-white/5 px-3 py-3 flex-shrink-0' },
          h('div', { className: 'flex items-center gap-2.5' },
            h('div', {
              className: 'w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0',
              style: { backgroundColor: genAvatar(identity.displayName) }
            }, identity.displayName.split(' ').map(n => n[0]).join('').substring(0, 2)),
            sidebarOpen && h('div', { className: 'min-w-0 animate-fade-in' },
              h('div', { className: 'text-sm font-medium text-white truncate' }, identity.displayName),
              h('div', { className: 'flex items-center gap-1.5' },
                h('span', { className: 'w-1.5 h-1.5 rounded-full', style: { backgroundColor: availColor(identity.status) } }),
                h('span', { className: 'text-xs text-slate-400' }, identity.role)
              )
            )
          )
        )
      ),

      // Main content
      h('main', { className: 'flex-1 flex flex-col overflow-hidden' },
        // Top bar
        h('header', { className: `h-14 flex items-center justify-between px-6 border-b flex-shrink-0 ${isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'} backdrop-blur-sm` },
          h('div', { className: 'flex items-center gap-4' },
            h('h1', { className: 'text-lg font-semibold tracking-tight' }, navItems.find(n => n.id === view)?.label || 'Dashboard'),
            view === 'tickets' && h('span', { className: `text-xs px-2 py-0.5 rounded-full font-mono ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-600'}` }, filteredTickets.length)
          ),
          h('div', { className: 'flex items-center gap-2' },
            view === 'tickets' && h('button', {
              onClick: () => setShowCreateModal(true),
              className: 'flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg transition-colors'
            }, h(Icon, { name: 'plus', size: 14 }), 'New Ticket'),
            h('button', {
              onClick: toggleTheme,
              className: `p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-600'}`
            }, h(Icon, { name: isDark ? 'sun' : 'moon', size: 18 }))
          )
        ),

        // View content
        h('div', { className: 'flex-1 overflow-hidden flex' },
          view === 'dashboard' && h(DashboardView, { state, metrics, agents: agentsList, isDark }),
          view === 'tickets' && h(TicketsView, {
            tickets: filteredTickets, selectedTicketId, setSelectedTicketId,
            searchQuery, setSearchQuery, filterStatus, setFilterStatus,
            filterPriority, setFilterPriority, isDark,
            onClaim: handleClaimTicket, onEscalate: handleEscalateTicket,
            onResolve: handleResolveTicket, onCloseTicket: handleCloseTicket, onReopenTicket: handleReopenTicket, onSendMessage: handleSendMessage,
            identity, setShowCreateModal,
            trustedElevated: settings.security?.trustedElevated || []
          }),
          view === 'chat' && h(ChatView, { tickets: visibleTickets, isDark, identity, onSendMessage: handleSendMessage, selectedTicketId, setSelectedTicketId }),
          view === 'agents' && h(AgentsView, { agents: agentsList, tickets: state.tickets, isDark, identity, onStartChat: handleStartAgentChat }),
          view === 'escalations' && h(EscalationsView, { state, isDark, onClaim: handleClaimTicket, identity, slaConfig: settings.sla }),
          view === 'network' && h(NetworkView, {
            state, isDark, gossipRound, syncLog, identity,
            peerStatus, peerId, connections, connectTarget, setConnectTarget,
            onConnectPeer: connectToPeer, onDisconnectPeer: disconnectPeer, onSyncNow: sendSnapshotToAll,
            onRequestSnapshot: requestSnapshotFromPeer, onPingPeer: pingPeer, onReconnectPeerJS: reconnectPeerJS,
            knownPeersById,
            outbox,
            onFlushOutbox: flushOutbox,
            onClearOutbox: () => {
              setOutbox([]);
              logSync('Outbox cleared', 'warning');
            },
            peerVotes,
            onVoteMute: castVoteMute,
            mutedPeers: settings.security?.mutedPeers || [],
            quarantinedPeers: settings.security?.quarantinedPeers || [],
            onQuarantine: addQuarantine,
            onReleaseQuarantine: removeQuarantine,
            onSharePeerList: sendPeerListToAll,
            onRequestPeerList: (peerIdToRequest) => {
              const conn = connsRef.current.get(peerIdToRequest);
              if (!conn || !conn.open) {
                logSync(`Cannot request peer list from ${peerIdToRequest}`, 'warning');
                return;
              }
              try { conn.send({ type: 'req_peer_list' }); } catch (e) {}
            }
          }),
          view === 'audit' && h(AuditView, {
            auditLog,
            isDark,
            onTrustSigner: (fingerprint) => {
              if (!fingerprint) return;
              setSettings(s => ({
                ...s,
                security: {
                  ...s.security,
                  trustedElevated: Array.from(new Set([fingerprint, ...(s.security?.trustedElevated || [])]))
                }
              }));
            },
            onRequestSnapshot: requestSnapshotFromPeer,
            onMutePeer: (peerIdToMute) => {
              if (!peerIdToMute) return;
              setSettings(s => ({
                ...s,
                security: {
                  ...s.security,
                  mutedPeers: Array.from(new Set([peerIdToMute, ...(s.security?.mutedPeers || [])]))
                }
              }));
              logAudit(`Peer muted locally`, 'warning', peerIdToMute);
            },
            onUnmutePeer: (peerIdToUnmute) => {
              if (!peerIdToUnmute) return;
              setSettings(s => ({
                ...s,
                security: {
                  ...s.security,
                  mutedPeers: (s.security?.mutedPeers || []).filter(p => p !== peerIdToUnmute)
                }
              }));
              logAudit(`Peer unmuted locally`, 'info', peerIdToUnmute);
            },
            onViewTicket: (ticketId) => {
              if (!ticketId) return;
              setSelectedTicketId(ticketId);
              setView('tickets');
            },
            onCopyDetails: async (entry) => {
              if (!entry) return;
              const details = {
                eventId: entry.eventId || null,
                ticketId: entry.ticketId || null,
                actor: entry.actor || null,
                actorRole: entry.actorRole || null,
                actorPeerId: entry.actorPeerId || null,
                actorFingerprint: entry.actorFingerprint || entry.signerFingerprint || null,
                eventType: entry.eventType || null,
                seq: entry.seq || null,
                peerId: entry.peerId || null,
                ts: entry.ts || null,
                msg: entry.msg || null
              };
              const text = JSON.stringify(details, null, 2);
              try { await navigator.clipboard.writeText(text); } catch (e) {}
            },
            onExportJson: () => downloadJson(`meshdesk-audit-${new Date().toISOString()}.json`, auditLog),
            onExportCsv: () => {
              const rows = [
                ['ts', 'level', 'peerId', 'eventId', 'ticketId', 'actor', 'actorPeerId', 'actorFingerprint', 'eventType', 'message']
              ];
              (auditLog || []).forEach(e => {
                rows.push([
                  e.ts, e.level, e.peerId, e.eventId, e.ticketId, e.actor,
                  e.actorPeerId, e.actorFingerprint || e.signerFingerprint, e.eventType, e.msg
                ]);
              });
              downloadCsv(`meshdesk-audit-${new Date().toISOString()}.csv`, rows);
            },
            mutedPeers: settings.security?.mutedPeers || [],
            trustedElevated: settings.security?.trustedElevated || []
          }),
            view === 'settings' && h(SettingsView, {
              identity,
              setIdentity,
              setPeerId,
              settings,
              setSettings,
              isDark,
              state,
              agents: agentsList,
              knownPeers,
              onSendPolicy: sendPolicyToAll,
              pendingPolicies,
              onAcceptPolicy: acceptPolicyProposal,
              onRejectPolicy: rejectPolicyProposal,
              onExportState: exportStateSnapshot,
              onImportState: importStateSnapshot
            })
        ),

        // Footer
        h('footer', { className: `h-8 flex items-center justify-center border-t text-xs flex-shrink-0 ${isDark ? 'bg-slate-900 border-slate-800 text-slate-500' : 'bg-white border-slate-200 text-slate-400'}` },
          h('div', { className: 'flex items-center gap-2' },
            h('span', null, 'Powered by'),
            h('a', {
              href: 'https://fractal.co.ke',
              className: 'font-semibold text-brand-400 hover:text-brand-300 tracking-wide'
            }, 'Fractal'),
            h('span', { className: isDark ? 'text-slate-600' : 'text-slate-300' }, '•'),
            h('span', { className: 'uppercase text-[10px] tracking-[0.2em] text-slate-500' }, 'Decentralized Support')
          )
        )
      ),

      // Create ticket modal
      showCreateModal && h(CreateTicketModal, { onClose: () => setShowCreateModal(false), onCreate: handleCreateTicket, isDark, identity })
    )
  );
}

// ============ ONBOARDING MODAL ============
function OnboardingModal({ onComplete, isDark }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('L1');
  const [step, setStep] = useState(0);
  const [fingerprint, setFingerprint] = useState('');
  const [keyMaterial, setKeyMaterial] = useState(null);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    const keys = await generateIdentityKeys();
    setKeyMaterial(keys);
    setFingerprint(keys.fingerprint);
    setGenerating(false);
    setStep(1);
  };

  return h('div', { className: 'h-screen w-screen flex items-center justify-center bg-slate-950 dark' },
    h('div', { className: 'w-full max-w-md p-8 animate-fade-in' },
      h('div', { className: 'flex items-center gap-3 mb-8' },
        h('div', { className: 'w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center' },
          h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'white', strokeWidth: 2 },
            h('path', { d: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9' })
          )
        ),
        h('div', null,
          h('h1', { className: 'text-2xl font-bold text-white tracking-tight' }, 'MeshDesk'),
          h('p', { className: 'text-sm text-slate-400' }, 'Decentralized Support Platform')
        )
      ),

      step === 0 && h('div', { className: 'animate-fade-in' },
        h('h2', { className: 'text-xl font-semibold text-white mb-2' }, 'Welcome to the Mesh'),
        h('p', { className: 'text-slate-400 mb-6 text-sm leading-relaxed' },
          'MeshDesk is a fully decentralized support platform. Your identity is cryptographic — no servers, no accounts. Every browser is a node in the network.'
        ),
        h('div', { className: 'p-4 rounded-lg bg-slate-800/50 border border-slate-700/50 mb-6' },
          h('div', { className: 'text-xs text-slate-500 mb-1 font-mono' }, 'Your generated fingerprint:'),
          h('div', { className: 'font-mono text-sm text-brand-400 break-all' }, fingerprint || 'Ready to generate...')
        ),
        h('button', {
          onClick: handleGenerate,
          disabled: generating,
          className: generating
            ? 'w-full py-2.5 bg-slate-700 text-slate-500 cursor-not-allowed rounded-lg font-medium transition-colors text-sm'
            : 'w-full py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-medium transition-colors text-sm'
        }, generating ? 'Generating...' : 'Generate Identity →')
      ),

      step === 1 && h('div', { className: 'animate-fade-in' },
        h('h2', { className: 'text-xl font-semibold text-white mb-4' }, 'Set Up Your Profile'),
        h('div', { className: 'space-y-4 mb-6' },
          h('div', null,
            h('label', { className: 'text-sm text-slate-400 block mb-1.5' }, 'Display Name'),
            h('input', {
              type: 'text', value: name, onChange: e => setName(e.target.value),
              placeholder: 'Enter your name...',
              className: 'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:border-brand-500 transition-colors'
            })
          ),
          h('div', null,
            h('label', { className: 'text-sm text-slate-400 block mb-1.5' }, 'Role'),
          h('select', {
            value: role, onChange: e => setRole(e.target.value),
            className: 'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-brand-500 transition-colors'
          },
            IDENTITY_ROLES.map(r => h('option', { key: r, value: r }, r === 'Customer' ? 'Customer' : r + ' Support'))
          )
        )
        ),
        h('button', {
          onClick: () => onComplete(name, role, keyMaterial),
          disabled: !name.trim() || !keyMaterial,
          className: `w-full py-2.5 rounded-lg font-medium transition-colors text-sm ${name.trim() && keyMaterial ? 'bg-brand-500 hover:bg-brand-600 text-white' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`
        }, 'Join the Network')
      )
    )
  );
}

// ============ DASHBOARD VIEW ============
function DashboardView({ state, metrics, agents, isDark }) {
  const bg = isDark ? 'bg-slate-800/50 border-slate-700/50' : 'bg-white border-slate-200';
  const metricCards = [
    { label: 'Open Tickets', value: metrics.openTickets, color: '#6366F1', trend: '+3' },
    { label: 'Avg Response', value: Math.floor(metrics.avgResponse/60) + 'm ' + (metrics.avgResponse%60) + 's', color: '#3B82F6', trend: '-12s' },
    { label: 'Agents Online', value: metrics.agentsOnline, color: '#10B981', trend: '+1' },
    { label: 'Escalations', value: metrics.escalationsActive, color: metrics.escalationsActive > 0 ? '#EF4444' : '#10B981', trend: metrics.escalationsActive > 0 ? '+1' : '0' },
  ];
  const [expandedGroups, setExpandedGroups] = useState({});
  const feedEntries = useMemo(() => {
    const entries = [];
    const events = state.events.slice(0, 60);
    for (let i = 0; i < events.length; i++) {
      const evt = events[i];
      if (evt.type === 'MessageSent') {
        const ticketId = evt.ticketId;
        const messages = [evt];
        let j = i + 1;
        while (j < events.length && events[j].type === 'MessageSent' && events[j].ticketId === ticketId) {
          messages.push(events[j]);
          j++;
        }
        entries.push({ id: `msg:${ticketId}:${evt.ts}`, kind: 'message-group', ticketId, messages, ts: evt.ts });
        i = j - 1;
        continue;
      }
      entries.push({ id: evt.id, kind: 'event', event: evt, ts: evt.ts });
    }
    return entries.slice(0, 30);
  }, [state.events]);

  return h('div', { className: 'flex-1 overflow-y-auto p-6' },
    // Metric cards
    h('div', { className: 'grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6' },
      metricCards.map((m, i) =>
        h('div', {
          key: i,
          className: `rounded-xl border p-5 ${bg} animate-fade-in`,
          style: { animationDelay: i * 80 + 'ms', animationFillMode: 'both' }
        },
          h('div', { className: `text-xs font-medium mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}` }, m.label),
          h('div', { className: 'flex items-end gap-2' },
            h('span', { className: 'text-3xl font-bold tracking-tight animate-count-up', style: { color: m.color } }, m.value),
            h('span', { className: `text-xs font-mono pb-1 ${m.trend.startsWith('+') ? 'text-emerald-400' : m.trend.startsWith('-') ? 'text-red-400' : 'text-slate-500'}` }, m.trend)
          )
        )
      )
    ),

    h('div', { className: 'grid grid-cols-1 lg:grid-cols-5 gap-6' },
      // Activity feed
      h('div', { className: `lg:col-span-3 rounded-xl border ${bg} overflow-hidden` },
        h('div', { className: `px-5 py-3 border-b font-medium text-sm ${isDark ? 'border-slate-700/50' : 'border-slate-200'}` }, 'Activity Feed'),
        h('div', { className: 'divide-y max-h-96 overflow-y-auto', style: { maxHeight: 420 } },
          feedEntries.map((entry, i) => {
              const evtColors = {
                'TicketCreated': 'text-blue-400', 'TicketAssigned': 'text-indigo-400', 'TicketEscalated': 'text-red-400',
                'TicketResolved': 'text-emerald-400', 'TicketClosed': 'text-slate-400', 'TicketReopened': 'text-amber-400',
                'MessageSent': 'text-slate-400', 'AgentStatus': 'text-amber-400',
                'SlaBreached': 'text-red-400', 'SupervisorAlerted': 'text-amber-400'
              };
            if (entry.kind === 'message-group') {
              const isExpanded = !!expandedGroups[entry.id];
              const count = entry.messages.length;
              const latest = entry.messages[0];
              return h('div', {
                key: entry.id,
                className: `px-5 py-3 text-sm animate-fade-in ${isDark ? 'hover:bg-slate-700/20' : 'hover:bg-slate-50'} transition-colors cursor-pointer`,
                style: { animationDelay: i * 30 + 'ms', animationFillMode: 'both' },
                onClick: () => setExpandedGroups(prev => ({ ...prev, [entry.id]: !prev[entry.id] }))
              },
                h('div', { className: 'flex items-start gap-3' },
                  h('span', { className: 'mt-0.5 text-slate-400' }, h(Icon, { name: 'chat', size: 14 })),
                  h('div', { className: 'flex-1 min-w-0' },
                    h('span', { className: `font-medium ${isDark ? 'text-slate-200' : 'text-slate-700'}` }, `${count} messages`),
                    h('span', { className: `mx-1.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, '·'),
                    h('span', { className: isDark ? 'text-slate-400' : 'text-slate-500' }, `Ticket ${entry.ticketId}`),
                    h('div', { className: `text-xs mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, latest?.detail?.substring(0, 70))
                  ),
                  h('span', { className: `text-xs flex-shrink-0 font-mono ${isDark ? 'text-slate-600' : 'text-slate-400'}` }, timeAgo(entry.ts))
                ),
                isExpanded && h('div', { className: `mt-3 pl-7 space-y-2 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}` },
                  entry.messages.map(msg =>
                    h('div', { key: msg.id, className: 'flex items-center gap-2' },
                      h('span', { className: 'font-medium' }, msg.actor),
                      h('span', { className: isDark ? 'text-slate-600' : 'text-slate-400' }, '·'),
                      h('span', null, msg.detail?.substring(0, 90))
                    )
                  )
                )
              );
            }
            const evt = entry.event;
            return h('div', {
              key: entry.id,
              className: `px-5 py-3 flex items-start gap-3 text-sm animate-fade-in ${isDark ? 'hover:bg-slate-700/20' : 'hover:bg-slate-50'} transition-colors cursor-default`,
              style: { animationDelay: i * 30 + 'ms', animationFillMode: 'both' }
            },
                h('span', { className: `mt-0.5 ${evtColors[evt.type] || 'text-slate-400'}` },
                  h(Icon, { name: evt.type === 'TicketCreated' ? 'ticket' : evt.type === 'TicketAssigned' ? 'claim' : evt.type === 'TicketEscalated' ? 'escalation' : evt.type === 'TicketResolved' ? 'check' : evt.type === 'TicketClosed' ? 'close' : evt.type === 'TicketReopened' ? 'arrow_up' : evt.type === 'MessageSent' ? 'chat' : 'users', size: 14 })
                ),
              h('div', { className: 'flex-1 min-w-0' },
                h('span', { className: `font-medium ${isDark ? 'text-slate-200' : 'text-slate-700'}` }, evt.actor),
                h('span', { className: `mx-1.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, '·'),
                h('span', { className: isDark ? 'text-slate-400' : 'text-slate-500' }, evt.detail?.substring(0, 70))
              ),
              h('span', { className: `text-xs flex-shrink-0 font-mono ${isDark ? 'text-slate-600' : 'text-slate-400'}` }, timeAgo(evt.ts))
            );
          })
        )
      ),

      // Agent workload
      h('div', { className: `lg:col-span-2 rounded-xl border ${bg} overflow-hidden` },
        h('div', { className: `px-5 py-3 border-b font-medium text-sm ${isDark ? 'border-slate-700/50' : 'border-slate-200'}` }, 'Agent Workload'),
      h('div', { className: 'p-5 space-y-3' },
        agents.filter(a => a.status !== 'Offline').map(agent => {
          const agentTickets = state.tickets.filter(t => t.agent === agent.name && !['Resolved', 'Closed'].includes(t.status));
          const maxLoad = 8;
          const pct = Math.min(100, (agentTickets.length / maxLoad) * 100);
          return h('div', { key: agent.id, className: 'animate-fade-in' },
              h('div', { className: 'flex items-center justify-between mb-1' },
                h('div', { className: 'flex items-center gap-2' },
                  h('span', { className: 'w-1.5 h-1.5 rounded-full', style: { backgroundColor: availColor(agent.status) } }),
                  h('span', { className: 'text-sm font-medium' }, agent.name)
                ),
                h('span', { className: `text-xs font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, agentTickets.length + ' tickets')
              ),
              h('div', { className: `w-full h-2 rounded-full ${isDark ? 'bg-slate-700' : 'bg-slate-200'}` },
                h('div', {
                  className: 'h-full rounded-full transition-all duration-500',
                  style: { width: pct + '%', backgroundColor: pct > 75 ? '#EF4444' : pct > 50 ? '#F59E0B' : '#6366F1' }
                })
              )
            );
          })
        )
      )
    )
  );
}

// ============ TICKETS VIEW ============
function TicketsView({ tickets, selectedTicketId, setSelectedTicketId, searchQuery, setSearchQuery, filterStatus, setFilterStatus, filterPriority, setFilterPriority, isDark, onClaim, onEscalate, onResolve, onCloseTicket, onReopenTicket, onSendMessage, identity, setShowCreateModal, trustedElevated }) {
  const bg = isDark ? 'bg-slate-800/50 border-slate-700/50' : 'bg-white border-slate-200';
  const selectedTicket = tickets.find(t => t.id === selectedTicketId) || null;

  return h('div', { className: 'flex-1 flex overflow-hidden' },
    // Ticket list
    h('div', { className: `flex-1 flex flex-col overflow-hidden ${selectedTicket ? 'hidden lg:flex' : 'flex'}` },
      // Filters
      h('div', { className: `px-4 py-3 flex flex-wrap items-center gap-2 border-b flex-shrink-0 ${isDark ? 'border-slate-800' : 'border-slate-200'}` },
        h('div', { className: 'relative flex-1 min-w-48' },
          h('span', { className: `absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, h(Icon, { name: 'search', size: 14 })),
          h('input', {
            id: 'search-input',
            type: 'text', value: searchQuery, onChange: e => setSearchQuery(e.target.value),
            placeholder: 'Search tickets... (/ to focus)',
            className: `w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border ${isDark ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'} focus:outline-none focus:border-brand-500 transition-colors`
          })
        ),
        h('select', {
          value: filterStatus, onChange: e => setFilterStatus(e.target.value),
          className: `px-2.5 py-1.5 text-sm rounded-lg border ${isDark ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-white border-slate-200 text-slate-700'} focus:outline-none focus:border-brand-500`
        }, ['All', ...STATUSES].map(s => h('option', { key: s, value: s }, s === 'All' ? 'All Statuses' : s))),
        h('select', {
          value: filterPriority, onChange: e => setFilterPriority(e.target.value),
          className: `px-2.5 py-1.5 text-sm rounded-lg border ${isDark ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-white border-slate-200 text-slate-700'} focus:outline-none focus:border-brand-500`
        }, ['All', ...PRIORITIES].map(p => h('option', { key: p, value: p }, p === 'All' ? 'All Priorities' : p)))
      ),

      // Ticket list
      h('div', { className: 'flex-1 overflow-y-auto' },
        tickets.length === 0 ?
          h('div', { className: 'flex flex-col items-center justify-center h-full text-center p-8' },
            h(Icon, { name: 'ticket', size: 48, className: isDark ? 'text-slate-700' : 'text-slate-300' }),
            h('p', { className: `mt-4 text-lg font-medium ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'No tickets found'),
            h('p', { className: `text-sm ${isDark ? 'text-slate-600' : 'text-slate-400'}` }, 'Adjust your filters or create a new ticket')
          ) :
          tickets.map((ticket, i) =>
            h('div', {
              key: ticket.id,
              onClick: () => setSelectedTicketId(ticket.id),
              className: `flex items-center gap-4 px-4 py-3 border-b cursor-pointer transition-colors animate-fade-in ${
                selectedTicket?.id === ticket.id
                  ? isDark ? 'bg-brand-500/10 border-brand-500/20' : 'bg-brand-50 border-brand-200'
                  : isDark ? 'hover:bg-slate-800/50 border-slate-800' : 'hover:bg-slate-50 border-slate-100'
              }`,
              style: { animationDelay: i * 20 + 'ms', animationFillMode: 'both' }
            },
              // Priority indicator
              h('div', { className: 'w-1 h-10 rounded-full flex-shrink-0', style: { backgroundColor: priorityColor(ticket.priority) } }),
              // Content
              h('div', { className: 'flex-1 min-w-0' },
                h('div', { className: 'flex items-center gap-2 mb-1' },
                  h('span', { className: `font-mono text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, ticket.id),
                  h('span', { className: `px-1.5 py-0.5 text-xs rounded border ${statusColor(ticket.status)}` }, ticket.status),
                  h('span', { className: `px-1.5 py-0.5 text-xs rounded ${roleStyle(ticket.escalationLevel)}` }, ticket.escalationLevel)
                ),
                h('div', { className: `text-sm font-medium truncate ${isDark ? 'text-slate-200' : 'text-slate-800'}` }, ticket.subject),
                h('div', { className: `text-xs mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}` },
                  ticket.customer,
                  ticket.agent && h('span', null, ' → ', ticket.agent)
                )
              ),
              // Meta
              h('div', { className: 'text-right flex-shrink-0' },
                h('div', { className: `text-xs font-mono ${isDark ? 'text-slate-600' : 'text-slate-400'}` }, timeAgo(ticket.updated)),
                h('div', { className: 'flex items-center gap-1 mt-1 justify-end' },
                  h('span', { className: `text-xs ${isDark ? 'text-slate-600' : 'text-slate-400'}` }, ticket.messages.length + ' msgs')
                )
              )
            )
          )
      )
    ),

    // Detail panel
    selectedTicket && h(TicketDetailPanel, {
      ticket: selectedTicket, isDark, onClose: () => setSelectedTicketId(null),
      onClaim, onEscalate, onResolve, onCloseTicket, onReopenTicket, onSendMessage, identity, trustedElevated,
      setState: null
    })
  );
}

// ============ TICKET DETAIL PANEL ============
function TicketDetailPanel({ ticket, isDark, onClose, onClaim, onEscalate, onResolve, onCloseTicket, onReopenTicket, onSendMessage, identity, trustedElevated, fullWidth = false }) {
  const [msgInput, setMsgInput] = useState('');
  const msgsEndRef = useRef(null);
  const bg = isDark ? 'bg-slate-800/80 border-slate-700/50' : 'bg-white border-slate-200';
  const isTrusted = identity?.publicKeyFingerprint && (trustedElevated || []).includes(identity.publicKeyFingerprint);
  const canClaim = identity?.role && identity.role !== 'Customer';
  const canEscalate = canClaim && isTrusted && !['Escalated', 'Resolved', 'Closed'].includes(ticket.status);
  const canResolve = canClaim && !['Resolved', 'Closed'].includes(ticket.status) && (ticket.agentId === identity?.peerId || isTrusted);
  const isOwner = identity?.role === 'Customer' && ticket.customerPeerId === identity?.peerId;
  const canClose = ticket.status !== 'Closed' && (isTrusted || (ticket.status === 'Resolved' && isOwner));
  const canReopen = ticket.status === 'Closed' && (isTrusted || isOwner);

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ticket.messages.length]);

  return h('div', { className: `${fullWidth ? 'flex-1 w-full' : 'w-full lg:w-[440px] xl:w-[500px]'} flex flex-col border-l animate-slide-in ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'}` },
    // Header
    h('div', { className: `px-4 py-3 border-b flex items-center justify-between flex-shrink-0 ${isDark ? 'border-slate-800' : 'border-slate-200'}` },
      h('div', { className: 'flex items-center gap-2 min-w-0' },
        h('button', {
          onClick: onClose,
          className: `p-1 rounded lg:hidden ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-200'}`
        }, h(Icon, { name: 'chevron_left', size: 16 })),
        h('span', { className: 'font-mono text-sm text-brand-400' }, ticket.id),
        h('span', { className: `px-1.5 py-0.5 text-xs rounded border ${statusColor(ticket.status)}` }, ticket.status)
      ),
      h('div', { className: 'flex items-center gap-1' },
        canClaim && !ticket.agent && h('button', {
          onClick: () => onClaim(ticket.id),
          className: 'px-2.5 py-1 text-xs bg-brand-500 hover:bg-brand-600 text-white rounded-md font-medium transition-colors'
        }, 'Claim'),
        canClaim && h('button', {
          onClick: () => canEscalate && onEscalate(ticket.id),
          disabled: !canEscalate,
          className: `px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${canEscalate ? (isDark ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-red-50 text-red-600 hover:bg-red-100') : (isDark ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-slate-100 text-slate-400 cursor-not-allowed')}`
        }, 'Escalate'),
        canClaim && h('button', {
          onClick: () => canResolve && onResolve(ticket.id),
          disabled: !canResolve,
          className: `px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${canResolve ? (isDark ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100') : (isDark ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-slate-100 text-slate-400 cursor-not-allowed')}`
        }, 'Resolve'),
        canClose && h('button', {
          onClick: () => onCloseTicket(ticket.id),
          className: `px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${isDark ? 'bg-slate-700 text-slate-200 hover:bg-slate-600' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`
        }, 'Close'),
        canReopen && h('button', {
          onClick: () => onReopenTicket(ticket.id),
          className: `px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${isDark ? 'bg-amber-500/10 text-amber-300 hover:bg-amber-500/20' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'}`
        }, 'Reopen'),
        h('button', {
          onClick: onClose,
          className: `p-1 rounded hidden lg:block ${isDark ? 'hover:bg-slate-800 text-slate-500' : 'hover:bg-slate-200 text-slate-400'}`
        }, h(Icon, { name: 'close', size: 16 }))
      )
    ),

    // Ticket meta
    h('div', { className: `px-4 py-3 border-b flex-shrink-0 ${isDark ? 'border-slate-800' : 'border-slate-200'}` },
      h('div', { className: 'text-sm font-semibold mb-2' }, ticket.subject),
      h('div', { className: 'flex flex-wrap gap-2 text-xs' },
        h('span', { className: 'px-2 py-0.5 rounded border border-current/20', style: { color: priorityColor(ticket.priority) } }, ticket.priority),
        h('span', { className: `px-2 py-0.5 rounded ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-600'}` }, ticket.category),
        h('span', { className: `px-2 py-0.5 rounded ${roleStyle(ticket.escalationLevel)}` }, ticket.escalationLevel),
        h('span', { className: `px-2 py-0.5 rounded font-mono ${isDark ? 'bg-slate-800 text-slate-500' : 'bg-slate-100 text-slate-500'}` }, ticket.replicationCount + ' peers')
      )
    ),

    // Messages
    h('div', { className: 'flex-1 overflow-y-auto p-4 space-y-3' },
      ticket.messages.map((msg, i) => {
        const isSelf = msg.senderPeerId
          ? msg.senderPeerId === identity?.peerId
          : (identity?.displayName && msg.sender === identity.displayName);
        return h('div', {
          key: msg.id,
          className: `flex ${isSelf ? 'justify-end' : 'justify-start'} animate-fade-in`,
          style: { animationDelay: i * 50 + 'ms', animationFillMode: 'both' }
        },
          h('div', {
            className: `max-w-[85%] rounded-xl px-4 py-2.5 ${
              isSelf
                ? 'bg-brand-500 text-white rounded-br-sm'
                : isDark ? 'bg-slate-800 text-slate-200 rounded-bl-sm' : 'bg-white text-slate-800 border border-slate-200 rounded-bl-sm'
            }`
          },
            h('div', { className: `text-xs font-medium mb-1 ${isSelf ? 'text-brand-200' : isDark ? 'text-slate-400' : 'text-slate-500'}` }, msg.sender),
            h('div', { className: 'text-sm leading-relaxed' }, msg.text),
            h('div', { className: `text-xs mt-1 ${isSelf ? 'text-brand-300' : isDark ? 'text-slate-600' : 'text-slate-400'}` }, timeAgo(msg.ts))
          )
        );
      }),
      h('div', { ref: msgsEndRef })
    ),

    // Input
    ticket.status !== 'Resolved' && ticket.status !== 'Closed' &&
    h('div', { className: `px-4 py-3 border-t flex gap-2 flex-shrink-0 ${isDark ? 'border-slate-800' : 'border-slate-200'}` },
      h('input', {
        type: 'text', value: msgInput, onChange: e => setMsgInput(e.target.value),
        placeholder: 'Type a message...',
        onKeyDown: e => { if (e.key === 'Enter' && msgInput.trim()) { onSendMessage(ticket.id, msgInput); setMsgInput(''); } },
        className: `flex-1 px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'} focus:outline-none focus:border-brand-500`
      }),
      h('button', {
        onClick: () => { if (msgInput.trim()) { onSendMessage(ticket.id, msgInput); setMsgInput(''); } },
        className: 'px-3 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg transition-colors'
      }, h(Icon, { name: 'send', size: 16 }))
    )
  );
}

// ============ CHAT VIEW ============
function ChatView({ tickets, isDark, identity, onSendMessage, selectedTicketId, setSelectedTicketId }) {
  const activeChats = tickets.filter(t => ['In Progress', 'Open', 'Waiting', 'Escalated'].includes(t.status) && t.messages.length > 0);
  const selectedChat = activeChats.find(t => t.id === selectedTicketId) || activeChats[0];

  return h('div', { className: 'flex-1 flex overflow-hidden' },
    // Chat list
    h('div', { className: `w-80 flex-shrink-0 border-r overflow-y-auto ${selectedChat ? 'hidden lg:block' : 'block w-full'} ${isDark ? 'border-slate-800' : 'border-slate-200'}` },
      h('div', { className: `px-4 py-3 border-b text-sm font-medium ${isDark ? 'border-slate-800' : 'border-slate-200'}` }, 'Active Conversations'),
      activeChats.map(t =>
        h('div', {
          key: t.id,
          onClick: () => setSelectedTicketId(t.id),
          className: `px-4 py-3 border-b cursor-pointer transition-colors ${
            selectedChat?.id === t.id
              ? isDark ? 'bg-brand-500/10 border-brand-500/20' : 'bg-brand-50 border-brand-200'
              : isDark ? 'hover:bg-slate-800/50 border-slate-800' : 'hover:bg-slate-50 border-slate-100'
          }`
        },
          h('div', { className: 'flex items-center gap-2 mb-1' },
            h('div', {
              className: 'w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0',
              style: { backgroundColor: t.customerAvatar }
            }, t.customer[0]),
            h('span', { className: 'text-sm font-medium flex-1 truncate' }, t.customer),
            h('span', { className: `text-xs font-mono ${isDark ? 'text-slate-600' : 'text-slate-400'}` }, timeAgo(t.updated))
          ),
          h('div', { className: `text-xs truncate ${isDark ? 'text-slate-500' : 'text-slate-400'}` },
            t.messages[t.messages.length - 1]?.text?.substring(0, 60)
          )
        )
      )
    ),

    // Chat window
    selectedChat ?
      h(TicketDetailPanel, {
        ticket: selectedChat, isDark, onClose: () => setSelectedTicketId(null),
        onClaim: () => {}, onEscalate: () => {}, onResolve: () => {}, onCloseTicket: () => {}, onReopenTicket: () => {}, onSendMessage, identity, trustedElevated: [],
        fullWidth: true
      }) :
      h('div', { className: 'flex-1 flex items-center justify-center' },
        h('div', { className: 'text-center' },
          h(Icon, { name: 'chat', size: 48, className: isDark ? 'text-slate-700 mx-auto' : 'text-slate-300 mx-auto' }),
          h('p', { className: `mt-4 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Select a conversation')
        )
      )
  );
}

// ============ AGENTS VIEW ============
function AgentsView({ agents, tickets, isDark, identity, onStartChat }) {
  const bg = isDark ? 'bg-slate-800/50 border-slate-700/50' : 'bg-white border-slate-200';
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const canChat = identity?.role && identity.role !== 'Customer';
  const filtered = useMemo(() => {
    return agents.filter(a => {
      if (statusFilter !== 'All' && a.status !== statusFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        return a.name.toLowerCase().includes(q) || a.peerId.toLowerCase().includes(q);
      }
      return true;
    });
  }, [agents, query, statusFilter]);
  const onlineCount = agents.filter(a => a.status === 'Online').length;

  return h('div', { className: 'flex-1 overflow-y-auto p-6 space-y-6' },
    h('div', { className: `rounded-xl border ${bg} p-5` },
      h('div', { className: 'flex flex-wrap items-center justify-between gap-4' },
        h('div', null,
          h('div', { className: 'text-sm font-medium' }, 'Agents Directory'),
          h('div', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}` }, `${onlineCount} online · ${agents.length} total`)
        ),
        h('div', { className: 'flex items-center gap-2' },
          h('input', {
            type: 'text',
            value: query,
            onChange: e => setQuery(e.target.value),
            placeholder: 'Search name or peer id',
            className: `px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          }),
          h('select', {
            value: statusFilter,
            onChange: e => setStatusFilter(e.target.value),
            className: `px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          }, ['All', ...AVAIL].map(s => h('option', { key: s, value: s }, s)))
        )
      )
    ),
    filtered.length === 0 ?
      h('div', { className: `rounded-xl border ${bg} p-8 text-center` },
        h(Icon, { name: 'users', size: 32, className: 'mx-auto text-slate-400 mb-2' }),
        h('p', { className: isDark ? 'text-slate-400' : 'text-slate-500' }, 'No agents match your filters')
      ) :
      h('div', { className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4' },
        filtered.map((agent, i) =>
          h('div', {
            key: agent.id,
            className: `rounded-xl border p-5 ${bg} animate-fade-in`,
            style: { animationDelay: i * 60 + 'ms', animationFillMode: 'both' }
          },
            h('div', { className: 'flex items-center gap-3 mb-4' },
              h('div', { className: 'relative' },
                h('div', {
                  className: 'w-12 h-12 rounded-xl flex items-center justify-center text-white text-sm font-bold',
                  style: { backgroundColor: agent.avatar }
                }, agent.name.split(' ').map(n => n[0]).join('')),
                h('span', {
                  className: 'absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2',
                  style: { backgroundColor: availColor(agent.status), borderColor: isDark ? '#1E293B' : '#fff' }
                })
              ),
              h('div', { className: 'min-w-0' },
                h('div', { className: 'text-sm font-semibold truncate' }, agent.name),
                h('span', { className: `text-xs px-1.5 py-0.5 rounded ${roleStyle(agent.role)}` }, agent.role)
              )
            ),
            h('div', { className: 'space-y-2 text-xs' },
              h('div', { className: 'flex justify-between' },
                h('span', { className: isDark ? 'text-slate-500' : 'text-slate-400' }, 'Status'),
                h('span', { style: { color: availColor(agent.status) } }, agent.status)
              ),
              h('div', { className: 'flex justify-between' },
                h('span', { className: isDark ? 'text-slate-500' : 'text-slate-400' }, 'Active Tickets'),
                h('span', { className: 'font-mono' }, tickets.filter(t => t.agent === agent.name && !['Resolved', 'Closed'].includes(t.status)).length)
              ),
              h('div', { className: 'flex justify-between' },
                h('span', { className: isDark ? 'text-slate-500' : 'text-slate-400' }, 'Peer ID'),
                h('span', { className: 'font-mono text-brand-400' }, agent.peerId.substring(0, 8) + '...')
              )
            ),
            canChat && agent.peerId !== identity?.peerId && h('button', {
              onClick: () => onStartChat(agent),
              disabled: agent.status !== 'Online',
              className: `mt-4 w-full px-3 py-2 text-xs rounded-lg font-medium transition-colors ${agent.status === 'Online' ? 'bg-brand-500 hover:bg-brand-600 text-white' : isDark ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`
            }, 'Start Live Chat')
          )
        )
      )
  );
}

// ============ ESCALATIONS VIEW ============
function EscalationsView({ state, isDark, onClaim, identity, slaConfig }) {
  const escalated = state.tickets.filter(t => t.status === 'Escalated');
  const bg = isDark ? 'bg-slate-800/50 border-slate-700/50' : 'bg-white border-slate-200';

  const rules = [
    { text: `Auto-escalate after ${slaConfig?.autoEscalateAfterMins || 0} minutes unassigned`, enabled: !!slaConfig?.enabled && (slaConfig?.autoEscalateAfterMins || 0) > 0 },
    { text: 'Escalate Critical tickets to L2 immediately', enabled: !!slaConfig?.enabled && !!slaConfig?.autoEscalateCritical },
    { text: `Alert Supervisor if ticket unresolved after ${slaConfig?.supervisorAlertAfterMins || 0} minutes`, enabled: !!slaConfig?.enabled && (slaConfig?.supervisorAlertAfterMins || 0) > 0 },
    { text: 'Track SLA due times by priority', enabled: !!slaConfig?.enabled }
  ];

  return h('div', { className: 'flex-1 overflow-y-auto p-6 space-y-6' },
    // Active escalations
    h('div', null,
      h('h2', { className: 'text-lg font-semibold mb-4' }, 'Active Escalations'),
      escalated.length === 0 ?
        h('div', { className: `rounded-xl border ${bg} p-8 text-center` },
          h(Icon, { name: 'check', size: 32, className: 'mx-auto text-emerald-500 mb-2' }),
          h('p', { className: isDark ? 'text-slate-400' : 'text-slate-500' }, 'No active escalations — smooth sailing!')
        ) :
        h('div', { className: 'space-y-3' },
          escalated.map((t, i) =>
            h('div', {
              key: t.id,
              className: `rounded-xl border ${bg} p-4 animate-fade-in`,
              style: { animationDelay: i * 80 + 'ms', animationFillMode: 'both' }
            },
              h('div', { className: 'flex items-start justify-between' },
                h('div', null,
                  h('div', { className: 'flex items-center gap-2 mb-1' },
                    h('span', { className: 'font-mono text-sm text-brand-400' }, t.id),
                    h('span', { className: `px-1.5 py-0.5 text-xs rounded ${roleStyle(t.escalationLevel)}` }, t.escalationLevel),
                    h('span', { className: 'px-1.5 py-0.5 text-xs rounded border', style: { color: priorityColor(t.priority), borderColor: priorityColor(t.priority) + '40' } }, t.priority)
                  ),
                  h('div', { className: 'text-sm font-medium' }, t.subject),
                  h('div', { className: `text-xs mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}` },
                    t.customer, t.agent && ` → ${t.agent}`, ` · ${timeAgo(t.updated)}`
                  )
                ),
                h('button', {
                  onClick: () => onClaim(t.id),
                  className: 'px-3 py-1.5 text-xs bg-brand-500 hover:bg-brand-600 text-white rounded-md font-medium transition-colors'
                }, 'Claim')
              )
            )
          )
        )
    ),

    // Rules
    h('div', null,
      h('h2', { className: 'text-lg font-semibold mb-4' }, 'Escalation Rules'),
      h('div', { className: 'space-y-2' },
        rules.map((r, i) =>
          h('div', {
            key: i,
            className: `rounded-xl border ${bg} p-4 flex items-center justify-between`
          },
            h('span', { className: `text-sm ${isDark ? 'text-slate-300' : 'text-slate-700'}` }, r.text),
            h('button', {
              className: `w-10 h-5 rounded-full transition-colors relative ${r.enabled ? 'bg-brand-500' : isDark ? 'bg-slate-700' : 'bg-slate-300'}`
            },
              h('div', {
                className: 'w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all',
                style: { left: r.enabled ? 22 : 2 }
              })
            )
          )
        )
      )
    )
  );
}

// ============ NETWORK VIEW ============
function NetworkView({ state, isDark, gossipRound, syncLog, identity, peerStatus, peerId, connections, connectTarget, setConnectTarget, onConnectPeer, onDisconnectPeer, onSyncNow, onRequestSnapshot, onPingPeer, onReconnectPeerJS, knownPeersById, outbox, onFlushOutbox, onClearOutbox, peerVotes, onVoteMute, mutedPeers, quarantinedPeers, onQuarantine, onReleaseQuarantine, onSharePeerList, onRequestPeerList }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const nodesRef = useRef([]);
  const bg = isDark ? 'bg-slate-800/50 border-slate-700/50' : 'bg-white border-slate-200';

  const peers = useMemo(() => {
    const p = [];
    if (identity) {
      p.push({ id: identity.peerId, name: identity.displayName, role: identity.role, status: 'Online', tickets: 0, color: '#6366F1', isSelf: true });
    }
    connections.forEach((c, i) => {
      const known = knownPeersById?.get(c.peerId);
      const displayName = known?.displayName || `Peer ${i + 1}`;
      const role = known?.role || 'L1';
      p.push({
        id: c.peerId,
        name: displayName,
        role,
        status: c.open ? 'Online' : 'Offline',
        tickets: 0,
        color: genAvatar(displayName || c.peerId),
        isSelf: false
      });
    });
    return p;
  }, [connections, identity, knownPeersById]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.parentElement.clientWidth;
    const hh = 320;
    canvas.width = w * 2;
    canvas.height = hh * 2;
    canvas.style.width = w + 'px';
    canvas.style.height = hh + 'px';
    ctx.scale(2, 2);

    ctx.clearRect(0, 0, w, hh);
    const bgGrad = ctx.createRadialGradient(w * 0.5, hh * 0.5, 20, w * 0.5, hh * 0.5, Math.max(w, hh));
    bgGrad.addColorStop(0, isDark ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.04)');
    bgGrad.addColorStop(1, isDark ? 'rgba(15,23,42,0.0)' : 'rgba(255,255,255,0.0)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, hh);

    // Subtle grid
    ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.05)' : 'rgba(148,163,184,0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, hh);
      ctx.stroke();
    }
    for (let y = 0; y < hh; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }

    if (peers.length === 0) {
      return;
    }

    // Initialize node positions
    if (nodesRef.current.length !== peers.length) {
      const cx = w / 2;
      const cy = hh / 2;
      nodesRef.current = peers.map((p, i) => {
        const angle = (i / peers.length) * Math.PI * 2 - Math.PI / 2;
        const r = Math.min(w, hh) * 0.32;
        return {
          x: cx + Math.cos(angle) * r + (Math.random() - 0.5) * 20,
          y: cy + Math.sin(angle) * r + (Math.random() - 0.5) * 20,
          vx: 0, vy: 0
        };
      });
    }

    let frame = 0;
    const animate = () => {
      ctx.clearRect(0, 0, w, hh);

      // Orbit rings
      ctx.beginPath();
      ctx.arc(w / 2, hh / 2, Math.min(w, hh) * 0.22, 0, Math.PI * 2);
      ctx.strokeStyle = isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.15)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w / 2, hh / 2, Math.min(w, hh) * 0.33, 0, Math.PI * 2);
      ctx.strokeStyle = isDark ? 'rgba(14,165,233,0.08)' : 'rgba(14,165,233,0.12)';
      ctx.stroke();

      // Draw edges
      const nodes = nodesRef.current;
      for (let i = 0; i < peers.length; i++) {
        for (let j = i + 1; j < peers.length; j++) {
          if (peers[i].status === 'Offline' || peers[j].status === 'Offline') continue;
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < 200) {
            const midX = (nodes[i].x + nodes[j].x) / 2;
            const midY = (nodes[i].y + nodes[j].y) / 2;
            const offset = Math.sin(frame * 0.01 + i + j) * 12;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.quadraticCurveTo(midX + offset, midY - offset, nodes[j].x, nodes[j].y);
            const alpha = (1 - dist / 200) * (isDark ? 0.22 : 0.26);
            ctx.strokeStyle = isDark ? `rgba(99,102,241,${alpha})` : `rgba(59,130,246,${alpha})`;
            ctx.lineWidth = 1.2;
            ctx.stroke();

            // Animated packet
            if (Math.sin(frame * 0.02 + i * 2 + j) > 0.7) {
              const t = (Math.sin(frame * 0.03 + i + j) + 1) / 2;
              const px = nodes[i].x + dx * t;
              const py = nodes[i].y + dy * t;
              ctx.beginPath();
              ctx.arc(px, py, 2, 0, Math.PI * 2);
              ctx.fillStyle = '#6366F1';
              ctx.fill();
            }
          }
        }
      }

      // Draw nodes
      peers.forEach((peer, i) => {
        const node = nodes[i];
        if (!node) return;
        const r = peer.isSelf ? 16 : 10 + Math.min(peer.tickets, 5) * 2;

        // Glow for self
        if (peer.isSelf) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 6 + Math.sin(frame * 0.05) * 2, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(99,102,241,0.12)';
          ctx.fill();
        }

        // Outer ring
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 2, 0, Math.PI * 2);
        ctx.strokeStyle = peer.status === 'Offline' ? (isDark ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.3)') : 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = peer.status === 'Offline' ? (isDark ? '#334155' : '#CBD5E1') : peer.color;
        ctx.globalAlpha = peer.status === 'Offline' ? 0.4 : 1;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Status dot
        ctx.beginPath();
        ctx.arc(node.x + r - 2, node.y - r + 2, 3, 0, Math.PI * 2);
        ctx.fillStyle = peer.status === 'Online' ? '#10B981' : peer.status === 'Busy' ? '#F59E0B' : peer.status === 'Idle' ? '#94A3B8' : '#64748B';
        ctx.fill();

        // Label plate
        const label = peer.name || peer.id;
        const role = peer.role || '';
        ctx.font = '10px IBM Plex Sans';
        const labelW = Math.max(ctx.measureText(label).width, ctx.measureText(role).width) + 10;
        const labelX = node.x - labelW / 2;
        const labelY = node.y + r + 10;
        ctx.fillStyle = isDark ? 'rgba(15,23,42,0.65)' : 'rgba(255,255,255,0.8)';
        ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(labelX, labelY, labelW, 22, 6);
        } else {
          ctx.rect(labelX, labelY, labelW, 22);
        }
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillStyle = isDark ? '#E2E8F0' : '#334155';
        ctx.fillText(label, node.x, labelY + 9);
        ctx.fillStyle = isDark ? '#94A3B8' : '#64748B';
        ctx.fillText(role, node.x, labelY + 18);

        // Gentle float
        nodes[i] = {
          ...node,
          x: node.x + Math.sin(frame * 0.01 + i) * 0.15,
          y: node.y + Math.cos(frame * 0.013 + i * 1.3) * 0.1
        };
      });

      frame++;
      animRef.current = requestAnimationFrame(animate);
    };

    animate();
    return () => cancelAnimationFrame(animRef.current);
  }, [peers, isDark]);

  const netStats = [
    { label: 'Connected Peers', value: Math.max(connections.length, 0) },
    { label: 'Events Synced', value: state.events.length },
    { label: 'Replication Factor', value: connections.length ? (1 + connections.length).toFixed(1) + 'x' : '1.0x' },
    { label: 'Gossip Round', value: gossipRound },
  ];
  const outboxStats = useMemo(() => {
    const count = outbox?.length || 0;
    if (!count) return { count: 0, lastAttempt: null, oldest: null };
    let oldest = null;
    let lastAttempt = null;
    outbox.forEach(e => {
      const created = e.createdAt ? new Date(e.createdAt).getTime() : null;
      const attempt = e.lastAttempt ? new Date(e.lastAttempt).getTime() : null;
      if (created && (!oldest || created < oldest)) oldest = created;
      if (attempt && (!lastAttempt || attempt > lastAttempt)) lastAttempt = attempt;
    });
    return {
      count,
      oldest: oldest ? new Date(oldest).toISOString() : null,
      lastAttempt: lastAttempt ? new Date(lastAttempt).toISOString() : null
    };
  }, [outbox]);

  return h('div', { className: 'flex-1 overflow-y-auto p-6 space-y-6' },
    // Peer controls
    h('div', { className: `rounded-xl border ${bg} p-5` },
      h('div', { className: 'flex items-start justify-between gap-4' },
        h('div', null,
          h('div', { className: 'text-sm font-medium mb-1' }, 'PeerJS Session'),
          h('div', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}` }, 'Uses the public PeerJS signaling server. Share your Peer ID to connect.'),
          h('div', { className: 'mt-3 flex flex-wrap items-center gap-3' },
            h('div', { className: `px-3 py-2 rounded-lg border font-mono text-sm ${isDark ? 'bg-slate-900 border-slate-700 text-brand-400' : 'bg-slate-50 border-slate-200 text-brand-600'}` },
              peerId || 'initializing...'
            ),
            h('div', { className: `text-xs px-2 py-1 rounded-full border ${peerStatus === 'online' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : peerStatus === 'connecting' ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' : 'text-red-400 border-red-500/30 bg-red-500/10'}` },
              peerStatus
            )
          ),
          h('div', { className: 'mt-3 flex items-center gap-2' },
            h('button', {
              onClick: onSyncNow,
              className: `px-3 py-2 text-xs rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`
            }, 'Sync Now'),
            h('button', {
              onClick: onReconnectPeerJS,
              className: `px-3 py-2 text-xs rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`
            }, 'Reconnect PeerJS')
          ),
          h('div', { className: 'mt-2 flex items-center gap-2' },
            h('button', {
              onClick: onSharePeerList,
              className: `px-3 py-2 text-xs rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`
            }, 'Share Peer List')
          )
        ),
        h('div', { className: 'min-w-[240px] w-full max-w-sm' },
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Connect to Peer ID'),
          h('div', { className: 'flex gap-2' },
            h('input', {
              type: 'text',
              value: connectTarget,
              onChange: e => setConnectTarget(e.target.value),
              onKeyDown: e => { if (e.key === 'Enter') onConnectPeer(); },
              placeholder: 'peer-id',
              className: `flex-1 px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
            }),
            h('button', {
              onClick: onConnectPeer,
              className: 'px-3 py-2 text-sm rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium'
            }, 'Connect')
          )
        )
      ),
      connections.length > 0 && h('div', { className: 'mt-4 text-xs' },
        h('div', { className: `mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}` }, 'Active Connections'),
        h('div', { className: 'space-y-2' },
          connections.map((c, i) => {
            const known = knownPeersById?.get(c.peerId);
            const displayName = known?.displayName || `Peer ${i + 1}`;
            const role = known?.role || 'L1';
            const voteCount = peerVotes?.[c.peerId]?.count || 0;
            const isMuted = mutedPeers?.includes(c.peerId);
            const isQuarantined = quarantinedPeers?.includes(c.peerId);
            return h('div', {
              key: c.peerId,
              className: `flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`
            },
              h('div', { className: 'flex items-center gap-2' },
                h('span', { className: `w-2 h-2 rounded-full ${c.open ? 'bg-emerald-500' : 'bg-slate-500'}` }),
                h('div', null,
                  h('div', { className: 'text-xs font-medium' }, displayName),
                  h('div', { className: `text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, role)
                )
              ),
              h('div', { className: 'flex items-center gap-2 flex-wrap' },
                h('span', { className: `text-[11px] px-2 py-0.5 rounded-full border ${c.open ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-slate-400 border-slate-500/30 bg-slate-500/10'}` }, c.open ? 'online' : 'offline'),
                voteCount > 0 && h('span', { className: 'text-[11px] px-2 py-0.5 rounded-full border border-amber-500/30 text-amber-400 bg-amber-500/10' }, `votes ${voteCount}`),
                h('button', {
                  onClick: () => onPingPeer(c.peerId),
                  className: 'text-[11px] px-2 py-1 rounded-md bg-slate-500/10 text-slate-400 hover:bg-slate-500/20'
                }, 'Ping'),
                h('button', {
                  onClick: () => onRequestSnapshot(c.peerId),
                  className: 'text-[11px] px-2 py-1 rounded-md bg-brand-500/10 text-brand-400 hover:bg-brand-500/20'
                }, 'Request Sync'),
                h('button', {
                  onClick: () => onRequestPeerList?.(c.peerId),
                  className: 'text-[11px] px-2 py-1 rounded-md bg-slate-500/10 text-slate-400 hover:bg-slate-500/20'
                }, 'Peer List'),
                h('button', {
                  onClick: () => onVoteMute?.(c.peerId),
                  className: 'text-[11px] px-2 py-1 rounded-md bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                }, 'Vote Mute'),
                !isQuarantined && h('button', {
                  onClick: () => onQuarantine?.(c.peerId),
                  className: 'text-[11px] px-2 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20'
                }, 'Quarantine'),
                isQuarantined && h('button', {
                  onClick: () => onReleaseQuarantine?.(c.peerId),
                  className: 'text-[11px] px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                }, 'Release'),
                h('button', {
                  onClick: () => onDisconnectPeer(c.peerId),
                  className: 'text-[11px] px-2 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20'
                }, 'Disconnect')
              )
            );
          })
        )
      )
    ),
    // Outbox
    h('div', { className: `rounded-xl border ${bg} p-5` },
      h('div', { className: 'flex items-start justify-between gap-4' },
        h('div', null,
          h('div', { className: 'text-sm font-medium mb-1' }, 'Offline Outbox'),
          h('div', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}` },
            outboxStats.count
              ? `Queued items: ${outboxStats.count}`
              : 'No queued items. Events will queue while offline.'
          ),
          outboxStats.oldest && h('div', { className: `text-[11px] mt-2 ${isDark ? 'text-slate-500' : 'text-slate-400'}` },
            'Oldest queued: ', new Date(outboxStats.oldest).toLocaleString()
          ),
          outboxStats.lastAttempt && h('div', { className: `text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}` },
            'Last attempt: ', new Date(outboxStats.lastAttempt).toLocaleString()
          )
        ),
        h('div', { className: 'flex items-center gap-2' },
          h('button', {
            onClick: () => onFlushOutbox?.('manual'),
            disabled: !outboxStats.count,
            className: `px-3 py-2 text-xs rounded-lg border ${outboxStats.count ? (isDark ? 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50') : (isDark ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed')}`
          }, 'Flush Outbox'),
          h('button', {
            onClick: () => onClearOutbox?.(),
            disabled: !outboxStats.count,
            className: `px-3 py-2 text-xs rounded-lg border ${outboxStats.count ? (isDark ? 'border-red-500/40 text-red-400 hover:bg-red-500/10' : 'border-red-200 text-red-500 hover:bg-red-50') : (isDark ? 'border-slate-800 text-slate-600 cursor-not-allowed' : 'border-slate-200 text-slate-400 cursor-not-allowed')}`
          }, 'Clear')
        )
      )
    ),
    // Mesh visualization
    h('div', { className: `rounded-xl border ${bg} overflow-hidden` },
      h('div', { className: `px-5 py-3 border-b font-medium text-sm ${isDark ? 'border-slate-700/50' : 'border-slate-200'}` }, 'Peer Mesh Topology'),
      h('div', { className: 'relative' },
        h('canvas', { ref: canvasRef, className: 'w-full' })
      )
    ),

    // Stats
    h('div', { className: 'grid grid-cols-2 lg:grid-cols-4 gap-4' },
      netStats.map((s, i) =>
        h('div', { key: i, className: `rounded-xl border ${bg} p-4` },
          h('div', { className: `text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'} mb-1` }, s.label),
          h('div', { className: 'text-2xl font-bold text-brand-400 font-mono' }, s.value)
        )
      )
    ),

    // Sync log
    h('div', { className: `rounded-xl border ${bg} overflow-hidden` },
      h('div', { className: `px-5 py-3 border-b font-medium text-sm ${isDark ? 'border-slate-700/50' : 'border-slate-200'}` }, 'Sync Log'),
      h('div', { className: 'p-4 font-mono text-xs space-y-1 max-h-48 overflow-y-auto' },
        syncLog.map(entry =>
          h('div', { key: entry.id, className: `${isDark ? 'text-slate-400' : 'text-slate-500'} animate-fade-in` },
            h('span', { className: isDark ? 'text-slate-600' : 'text-slate-400' }, new Date(entry.ts).toLocaleTimeString()),
            ' ',
            h('span', { className: 'text-brand-400' }, entry.msg)
          )
        ),
        syncLog.length === 0 && h('div', { className: isDark ? 'text-slate-600' : 'text-slate-400' }, 'Waiting for sync events...')
      )
    )
  );
}

// ============ AUDIT VIEW ============
function AuditView({ auditLog, isDark, onTrustSigner, onRequestSnapshot, onMutePeer, onUnmutePeer, onViewTicket, onCopyDetails, onExportJson, onExportCsv, mutedPeers, trustedElevated }) {
  const [filterPeer, setFilterPeer] = useState('all');
  const [filterLevel, setFilterLevel] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const levelStyle = (level) => {
    if (level === 'error') return isDark ? 'text-red-400' : 'text-red-600';
    if (level === 'warning') return isDark ? 'text-amber-400' : 'text-amber-600';
    return isDark ? 'text-slate-400' : 'text-slate-500';
  };
  const isMuted = (peerId) => (mutedPeers || []).includes(peerId);
  const isTrusted = (fingerprint) => (trustedElevated || []).includes(fingerprint);
  const peerOptions = useMemo(() => {
    const set = new Set();
    (auditLog || []).forEach(e => { if (e.peerId) set.add(e.peerId); });
    return Array.from(set);
  }, [auditLog]);
  const typeOptions = useMemo(() => {
    const set = new Set();
    (auditLog || []).forEach(e => { if (e.eventType) set.add(e.eventType); });
    return Array.from(set);
  }, [auditLog]);
  const filtered = useMemo(() => {
    return (auditLog || []).filter(e => {
      if (filterPeer !== 'all' && e.peerId !== filterPeer) return false;
      if (filterLevel !== 'all' && (e.level || 'info') !== filterLevel) return false;
      if (filterType !== 'all' && e.eventType !== filterType) return false;
      return true;
    });
  }, [auditLog, filterLevel, filterPeer, filterType]);

  return h('div', { className: 'flex-1 overflow-y-auto p-6 space-y-4 w-full max-w-none' },
    h('div', { className: 'flex items-center justify-between' },
      h('div', null,
        h('div', { className: 'text-lg font-semibold' }, 'Audit Log'),
        h('div', { className: `text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Signature failures, snapshot mismatches, rate-limit actions, and other security-related events.')
      ),
      h('div', { className: 'flex items-center gap-2' },
        h('button', { onClick: onExportJson, className: `px-3 py-1.5 text-xs rounded-lg border ${isDark ? 'border-slate-700 text-slate-300 hover:text-white' : 'border-slate-200 text-slate-600 hover:text-slate-900'}` }, 'Export JSON'),
        h('button', { onClick: onExportCsv, className: `px-3 py-1.5 text-xs rounded-lg border ${isDark ? 'border-slate-700 text-slate-300 hover:text-white' : 'border-slate-200 text-slate-600 hover:text-slate-900'}` }, 'Export CSV'),
        h('div', { className: `text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, `${filtered.length} entries`)
      ),
    ),
    h('div', { className: 'grid grid-cols-1 md:grid-cols-3 gap-3' },
      h('div', null,
        h('label', { className: `text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'} block mb-1` }, 'Peer'),
        h('select', {
          value: filterPeer,
          onChange: e => setFilterPeer(e.target.value),
          className: `w-full px-3 py-2 text-xs rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
        },
          h('option', { value: 'all' }, 'All peers'),
          peerOptions.map(p => h('option', { key: p, value: p }, p))
        )
      ),
      h('div', null,
        h('label', { className: `text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'} block mb-1` }, 'Level'),
        h('select', {
          value: filterLevel,
          onChange: e => setFilterLevel(e.target.value),
          className: `w-full px-3 py-2 text-xs rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
        },
          h('option', { value: 'all' }, 'All levels'),
          h('option', { value: 'error' }, 'Error'),
          h('option', { value: 'warning' }, 'Warning'),
          h('option', { value: 'info' }, 'Info')
        )
      ),
      h('div', null,
        h('label', { className: `text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'} block mb-1` }, 'Event Type'),
        h('select', {
          value: filterType,
          onChange: e => setFilterType(e.target.value),
          className: `w-full px-3 py-2 text-xs rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
        },
          h('option', { value: 'all' }, 'All types'),
          typeOptions.map(t => h('option', { key: t, value: t }, t))
        )
      )
    ),
    filtered.length === 0 && h('div', { className: `text-sm ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'No audit events yet.'),
    filtered.length > 0 && h('div', { className: `rounded-xl border ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-white'}` },
      h('div', { className: `grid grid-cols-12 gap-2 px-4 py-2 text-xs uppercase tracking-wide ${isDark ? 'text-slate-500 border-b border-slate-800' : 'text-slate-400 border-b border-slate-200'}` },
        h('div', { className: 'col-span-2' }, 'Time'),
        h('div', { className: 'col-span-2' }, 'Level'),
        h('div', { className: 'col-span-2' }, 'Peer'),
        h('div', { className: 'col-span-4' }, 'Message'),
        h('div', { className: 'col-span-2' }, 'Actions')
      ),
      h('div', { className: 'divide-y ' + (isDark ? 'divide-slate-800' : 'divide-slate-100') },
        filtered.map(entry =>
          h('div', { key: entry.id, className: 'grid grid-cols-12 gap-2 px-4 py-2 text-xs items-start' },
            h('div', { className: `col-span-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}` }, new Date(entry.ts).toLocaleTimeString()),
            h('div', { className: `col-span-2 font-medium ${levelStyle(entry.level)}` }, entry.level || 'info'),
            h('div', { className: `col-span-2 font-mono break-all ${isDark ? 'text-slate-300' : 'text-slate-700'}` }, entry.peerId || '—'),
            h('div', { className: `col-span-4 ${isDark ? 'text-slate-200' : 'text-slate-700'}` }, entry.msg),
            h('div', { className: 'col-span-2 flex flex-wrap gap-1' },
              h('button', {
                onClick: () => onCopyDetails?.(entry),
                className: `px-2 py-1 rounded border text-[11px] ${isDark ? 'border-slate-700 text-slate-300 hover:text-white' : 'border-slate-200 text-slate-600 hover:text-slate-900'}`
              }, 'Copy'),
              entry.ticketId && h('button', {
                onClick: () => onViewTicket?.(entry.ticketId),
                className: `px-2 py-1 rounded border text-[11px] ${isDark ? 'border-slate-700 text-slate-300 hover:text-white' : 'border-slate-200 text-slate-600 hover:text-slate-900'}`
              }, 'View'),
              (entry.actorFingerprint || entry.signerFingerprint) && (() => {
                const fp = entry.actorFingerprint || entry.signerFingerprint;
                const trusted = isTrusted(fp);
                return h('button', {
                  onClick: () => { if (!trusted) onTrustSigner?.(fp); },
                  disabled: trusted,
                  className: `px-2 py-1 rounded border text-[11px] ${trusted ? (isDark ? 'border-emerald-700 text-emerald-300' : 'border-emerald-200 text-emerald-700') : (isDark ? 'border-slate-700 text-slate-300 hover:text-white' : 'border-slate-200 text-slate-600 hover:text-slate-900')}`
                }, trusted ? 'Trusted' : 'Trust');
              })(),
              entry.peerId && h('button', {
                onClick: () => onRequestSnapshot?.(entry.peerId),
                className: `px-2 py-1 rounded border text-[11px] ${isDark ? 'border-slate-700 text-slate-300 hover:text-white' : 'border-slate-200 text-slate-600 hover:text-slate-900'}`
              }, 'Snapshot'),
              entry.peerId && !isMuted(entry.peerId) && h('button', {
                onClick: () => onMutePeer?.(entry.peerId),
                className: `px-2 py-1 rounded border text-[11px] ${isDark ? 'border-amber-700 text-amber-300 hover:text-white' : 'border-amber-200 text-amber-600 hover:text-amber-900'}`
              }, 'Mute'),
              entry.peerId && isMuted(entry.peerId) && h('button', {
                onClick: () => onUnmutePeer?.(entry.peerId),
                className: `px-2 py-1 rounded border text-[11px] ${isDark ? 'border-slate-700 text-slate-300 hover:text-white' : 'border-slate-200 text-slate-600 hover:text-slate-900'}`
              }, 'Unmute')
            )
          )
        )
      )
    )
  );
}

// ============ SETTINGS VIEW ============
function SettingsView({ identity, setIdentity, setPeerId, settings, setSettings, isDark, state, agents, knownPeers, onSendPolicy, pendingPolicies, onAcceptPolicy, onRejectPolicy, onExportState, onImportState }) {
  const [editName, setEditName] = useState(identity?.displayName || '');
  const [editRole, setEditRole] = useState(identity?.role || 'L1');
  const [trustInput, setTrustInput] = useState('');
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState(null);
  const [stateImportText, setStateImportText] = useState('');
  const [stateImportStatus, setStateImportStatus] = useState(null);
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [recoveryConfirm, setRecoveryConfirm] = useState('');
  const [recoveryBundleText, setRecoveryBundleText] = useState('');
  const [recoveryStatus, setRecoveryStatus] = useState(null);
  const [rotationStatus, setRotationStatus] = useState(null);
  const bg = isDark ? 'bg-slate-800/50 border-slate-700/50' : 'bg-white border-slate-200';
  const HelpTip = ({ text }) => h('span', {
    className: 'ml-1 relative group inline-flex items-center'
  },
    h('span', {
      className: `inline-flex items-center justify-center w-5 h-5 rounded-full border text-[11px] font-bold ${
        isDark ? 'border-slate-700 text-slate-200 bg-slate-900/60' : 'border-slate-300 text-slate-800 bg-white'
      }`
    }, '?'),
    h('span', {
      className: `absolute left-full top-1/2 ml-2 -translate-y-1/2 hidden group-hover:block whitespace-nowrap px-3 py-2 text-xs font-medium rounded-lg shadow-2xl border z-[60] ${
        isDark ? 'bg-slate-900 text-slate-100 border-slate-700' : 'bg-slate-900 text-slate-100 border-slate-800'
      }`
    }, text)
  );

  const handleSave = () => {
    const updated = { ...identity, displayName: editName, role: editRole };
    setIdentity(updated);
    saveIdentity(updated);
  };

  const handleClear = () => {
    if (confirm('This will delete all local data. Continue?')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  const addTrusted = () => {
    const fp = trustInput.trim();
    if (!fp) return;
    setSettings(s => ({
      ...s,
      security: {
        ...s.security,
        trustedElevated: Array.from(new Set([fp, ...(s.security?.trustedElevated || [])]))
      }
    }));
    setTrustInput('');
  };

  const removeTrusted = (fp) => {
    setSettings(s => ({
      ...s,
      security: {
        ...s.security,
        trustedElevated: (s.security?.trustedElevated || []).filter(x => x !== fp)
      }
    }));
  };

  const handleExportIdentity = async () => {
    if (!identity?.publicKeyJwk || !identity?.privateKeyJwk) return;
    const bundle = {
      ...identity,
      bundleVersion: 1,
      exportedAt: new Date().toISOString()
    };
    downloadJson(`meshdesk-identity-${identity.peerId || 'bundle'}.json`, bundle);
    if (navigator?.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2)); } catch (e) {}
    }
    setImportStatus({ type: 'info', msg: 'Identity bundle exported. Keep it private.' });
  };

  const handleImportIdentity = async () => {
    try {
      const parsed = JSON.parse(importText || '');
      if (!parsed?.publicKeyJwk || !parsed?.privateKeyJwk) throw new Error('missing');
      const computed = await fingerprintFromPublicJwk(parsed.publicKeyJwk);
      if (!computed) throw new Error('fingerprint');
      if (parsed.publicKeyFingerprint && parsed.publicKeyFingerprint !== computed) throw new Error('mismatch');
      const peerId = parsed.peerId || ('peer-' + computed.replace(/:/g, '').slice(0, 12));
      const updated = {
        ...parsed,
        publicKeyFingerprint: computed,
        peerId,
        displayName: parsed.displayName || editName || 'Anonymous',
        role: parsed.role || editRole || 'L1'
      };
      setIdentity(updated);
      saveIdentity(updated);
      setPeerId(updated.peerId);
      setImportStatus({ type: 'success', msg: 'Identity imported successfully.' });
    } catch (e) {
      setImportStatus({ type: 'error', msg: 'Invalid identity bundle.' });
    }
  };

  const handleImportState = async () => {
    if (!onImportState) return;
    const result = await onImportState(stateImportText);
    if (result?.ok) {
      setStateImportStatus({ type: 'success', msg: result.msg || 'State imported.' });
      setStateImportText('');
    } else {
      setStateImportStatus({ type: 'error', msg: result?.msg || 'State import failed.' });
    }
  };

  const handleGenerateRecovery = async () => {
    const phrase = await generateRecoveryPhrase();
    setRecoveryPhrase(phrase);
    setRecoveryConfirm('');
    setRecoveryStatus({ type: 'info', msg: 'Recovery phrase generated. Store it offline.' });
    if (navigator?.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(phrase); } catch (e) {}
    }
  };

  const handleExportRecoveryBundle = async () => {
    try {
      if (!identity?.publicKeyJwk || !identity?.privateKeyJwk) throw new Error('missing');
      if (!recoveryPhrase) throw new Error('phrase');
      const verified = await verifyRecoveryPhrase(recoveryPhrase);
      if (!verified) throw new Error('invalid');
      if (recoveryConfirm && parseRecoveryPhrase(recoveryConfirm) !== parseRecoveryPhrase(recoveryPhrase)) throw new Error('confirm');
      const bundle = await encryptIdentityBundle(identity, recoveryPhrase);
      downloadJson(`meshdesk-recovery-${identity.peerId || 'bundle'}.json`, bundle);
      setRecoveryStatus({ type: 'success', msg: 'Encrypted recovery bundle exported.' });
    } catch (e) {
      setRecoveryStatus({ type: 'error', msg: 'Failed to export recovery bundle.' });
    }
  };

  const handleImportRecoveryBundle = async () => {
    try {
      const parsed = JSON.parse(recoveryBundleText || '');
      if (!parsed?.ciphertext || !parsed?.salt || !parsed?.iv) throw new Error('format');
      const phraseOk = await verifyRecoveryPhrase(recoveryPhrase);
      if (!phraseOk) throw new Error('phrase');
      const recovered = await decryptIdentityBundle(parsed, recoveryPhrase);
      const computed = await fingerprintFromPublicJwk(recovered.publicKeyJwk);
      if (!computed) throw new Error('fingerprint');
      const peerId = recovered.peerId || ('peer-' + computed.replace(/:/g, '').slice(0, 12));
      const updated = {
        ...recovered,
        publicKeyFingerprint: computed,
        peerId,
        displayName: recovered.displayName || editName || 'Anonymous',
        role: recovered.role || editRole || 'L1'
      };
      setIdentity(updated);
      saveIdentity(updated);
      setPeerId(updated.peerId);
      setRecoveryStatus({ type: 'success', msg: 'Recovery bundle imported.' });
    } catch (e) {
      setRecoveryStatus({ type: 'error', msg: 'Recovery import failed.' });
    }
  };

  const handleRotateKeys = async () => {
    try {
      if (!identity?.privateKeyJwk || !identity?.publicKeyJwk) throw new Error('missing');
      const keys = await generateIdentityKeys();
      const rotationPayload = {
        oldFingerprint: identity.publicKeyFingerprint,
        newFingerprint: keys.fingerprint,
        newPublicKeyJwk: keys.publicKeyJwk,
        ts: new Date().toISOString()
      };
      const rotationSig = await signPayload(identity.privateKeyJwk, rotationPayload);
      const updated = {
        ...identity,
        publicKeyFingerprint: keys.fingerprint,
        publicKeyJwk: keys.publicKeyJwk,
        privateKeyJwk: keys.privateKeyJwk,
        peerId: keys.peerId,
        rotatedAt: rotationPayload.ts,
        rotationProof: { ...rotationPayload, sig: rotationSig }
      };
      setIdentity(updated);
      saveIdentity(updated);
      setPeerId(updated.peerId);
      setRotationStatus({ type: 'success', msg: 'Keys rotated. Share your new fingerprint.' });
    } catch (e) {
      setRotationStatus({ type: 'error', msg: 'Key rotation failed.' });
    }
  };

  const updateVoteThreshold = (value) => {
    const num = Math.max(1, Math.min(10, Number(value) || 1));
    setSettings(s => ({
      ...s,
      security: {
        ...s.security,
        voteThreshold: num
      }
    }));
  };

  const releaseQuarantine = (peerId) => {
    if (!peerId) return;
    setSettings(s => ({
      ...s,
      security: {
        ...s.security,
        quarantinedPeers: (s.security?.quarantinedPeers || []).filter(p => p !== peerId)
      }
    }));
  };

  return h('div', { className: 'flex-1 overflow-y-auto p-6 space-y-6 w-full max-w-none' },
    // Identity
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4 flex items-center gap-2' }, h(Icon, { name: 'key', size: 18 }), 'Cryptographic Identity'),
      h('div', { className: `p-4 rounded-lg mb-4 font-mono text-sm break-all ${isDark ? 'bg-slate-900 text-brand-400' : 'bg-slate-50 text-brand-600'}` },
        identity?.publicKeyFingerprint
      ),
      h('div', { className: `text-xs mb-4 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Peer ID: ', h('span', { className: 'font-mono text-brand-400' }, identity?.peerId)),
      h('div', { className: 'space-y-3' },
        h('div', null,
          h('label', { className: 'text-sm text-slate-400 block mb-1' }, 'Display Name', h(HelpTip, { text: 'Shown to other peers and used in events.' })),
          h('input', {
            type: 'text', value: editName, onChange: e => setEditName(e.target.value),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', null,
          h('label', { className: 'text-sm text-slate-400 block mb-1' }, 'Role', h(HelpTip, { text: 'Controls permissions for actions like claim/escalate/resolve.' })),
          h('select', {
            value: editRole, onChange: e => setEditRole(e.target.value),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          }, ROLES.map(r => h('option', { key: r, value: r }, r + ' Support')))
        ),
        h('button', { onClick: handleSave, className: 'px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm rounded-lg font-medium transition-colors' }, 'Save Changes')
      )
    ),

    // Identity backup
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4' }, 'Identity Backup & Recovery'),
      h('div', { className: `text-xs mb-4 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Export a private identity bundle and store it somewhere safe. Anyone with this file can impersonate you.'),
      h('div', { className: 'flex flex-wrap gap-2 mb-4' },
        h('button', { onClick: handleExportIdentity, className: 'px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm rounded-lg font-medium transition-colors' }, 'Export Identity'),
        h('button', { onClick: () => setImportText(''), className: `px-4 py-2 text-sm rounded-lg font-medium border ${isDark ? 'border-slate-700 text-slate-300 hover:text-white' : 'border-slate-200 text-slate-600 hover:text-slate-900'}` }, 'Clear Import')
      ),
      h('div', { className: 'space-y-2' },
        h('label', { className: 'text-sm text-slate-400 block' }, 'Import Identity Bundle'),
        h('textarea', {
          rows: 5,
          value: importText,
          onChange: e => setImportText(e.target.value),
          placeholder: 'Paste identity JSON here',
          className: `w-full px-3 py-2 text-xs rounded-lg border font-mono ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
        }),
        h('button', { onClick: handleImportIdentity, className: 'px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm rounded-lg font-medium transition-colors' }, 'Import Identity')
      ),
      importStatus && h('div', { className: `mt-3 text-xs ${importStatus.type === 'error' ? 'text-red-400' : importStatus.type === 'success' ? 'text-emerald-400' : 'text-slate-400'}` }, importStatus.msg)
    ),

    // Recovery phrase + rotation
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4' }, 'Recovery Phrase & Rotation'),
      h('div', { className: `text-xs mb-4 ${isDark ? 'text-slate-500' : 'text-slate-400'}` },
        'Generate a recovery phrase to encrypt your identity bundle. Store it offline. If you lose it, recovery is not possible.'
      ),
      h('div', { className: 'space-y-3' },
        h('div', null,
        h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Recovery Phrase', h(HelpTip, { text: 'Keep this offline. It encrypts your identity bundle for recovery.' })),
          h('input', {
            type: 'text',
            value: recoveryPhrase,
            onChange: e => setRecoveryPhrase(e.target.value),
            placeholder: 'Generate or paste your recovery phrase',
            className: `w-full px-3 py-2 text-xs rounded-lg border font-mono ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          }),
          h('div', { className: 'flex gap-2 mt-2' },
            h('button', { onClick: handleGenerateRecovery, className: 'px-3 py-2 bg-brand-500 hover:bg-brand-600 text-white text-xs rounded-lg font-medium transition-colors' }, 'Generate Phrase'),
            h('button', { onClick: handleExportRecoveryBundle, className: `px-3 py-2 text-xs rounded-lg font-medium border ${isDark ? 'border-slate-700 text-slate-300 hover:text-white' : 'border-slate-200 text-slate-600 hover:text-slate-900'}` }, 'Export Encrypted Bundle')
          )
        ),
        h('div', null,
        h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Confirm Phrase (optional)', h(HelpTip, { text: 'Optional check to avoid typos before exporting.' })),
          h('input', {
            type: 'text',
            value: recoveryConfirm,
            onChange: e => setRecoveryConfirm(e.target.value),
            placeholder: 'Re-enter phrase to confirm',
            className: `w-full px-3 py-2 text-xs rounded-lg border font-mono ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', null,
        h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Import Encrypted Recovery Bundle', h(HelpTip, { text: 'Paste the exported recovery JSON and use your phrase to decrypt.' })),
          h('textarea', {
            rows: 4,
            value: recoveryBundleText,
            onChange: e => setRecoveryBundleText(e.target.value),
            placeholder: 'Paste encrypted recovery JSON here',
            className: `w-full px-3 py-2 text-xs rounded-lg border font-mono ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          }),
          h('button', { onClick: handleImportRecoveryBundle, className: 'mt-2 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs rounded-lg font-medium transition-colors' }, 'Import Recovery')
        )
      ),
      recoveryStatus && h('div', { className: `mt-3 text-xs ${recoveryStatus.type === 'error' ? 'text-red-400' : recoveryStatus.type === 'success' ? 'text-emerald-400' : 'text-slate-400'}` }, recoveryStatus.msg),
      h('div', { className: 'mt-4 flex items-center justify-between' },
        h('div', null,
          h('div', { className: 'text-sm' }, 'Key Rotation', h(HelpTip, { text: 'Generates a new keypair and stores a signed rotation proof.' })),
          h('div', { className: `text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Generate a new keypair and create a rotation proof.')
        ),
        h('button', { onClick: handleRotateKeys, className: 'px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs rounded-lg font-medium transition-colors' }, 'Rotate Keys')
      ),
      rotationStatus && h('div', { className: `mt-2 text-xs ${rotationStatus.type === 'error' ? 'text-red-400' : rotationStatus.type === 'success' ? 'text-emerald-400' : 'text-slate-400'}` }, rotationStatus.msg)
    ),

    // State export/import
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4' }, 'State Export & Import', h(HelpTip, { text: 'Use for full backups or migrating between devices.' })),
      h('div', { className: `text-xs mb-4 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Export a signed snapshot of the current state or import one with validation. Use this for full backups and migrations.'),
      h('div', { className: 'flex flex-wrap gap-2 mb-4' },
        h('button', { onClick: onExportState, className: 'px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm rounded-lg font-medium transition-colors' }, 'Export State Snapshot'),
        h('button', { onClick: () => setStateImportText(''), className: `px-4 py-2 text-sm rounded-lg font-medium border ${isDark ? 'border-slate-700 text-slate-300 hover:text-white' : 'border-slate-200 text-slate-600 hover:text-slate-900'}` }, 'Clear Import')
      ),
      h('div', { className: 'space-y-2' },
        h('label', { className: 'text-sm text-slate-400 block' }, 'Import State Snapshot'),
        h('textarea', {
          rows: 5,
          value: stateImportText,
          onChange: e => setStateImportText(e.target.value),
          placeholder: 'Paste snapshot JSON here',
          className: `w-full px-3 py-2 text-xs rounded-lg border font-mono ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
        }),
        h('button', { onClick: handleImportState, className: 'px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm rounded-lg font-medium transition-colors' }, 'Import State')
      ),
      stateImportStatus && h('div', { className: `mt-3 text-xs ${stateImportStatus.type === 'error' ? 'text-red-400' : stateImportStatus.type === 'success' ? 'text-emerald-400' : 'text-slate-400'}` }, stateImportStatus.msg)
    ),

    // Trust & roles
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4' }, 'Trust & Role Enforcement'),
      h('div', { className: `text-xs mb-4 ${isDark ? 'text-slate-500' : 'text-slate-400'}` },
        'Only fingerprints in this list can perform elevated actions (escalations, supervisor overrides).',
        h(HelpTip, { text: 'Local-only trust. Each peer decides who can perform elevated actions.' })
      ),
      h('div', { className: `text-xs mb-2 ${isDark ? 'text-slate-500' : 'text-slate-400'}` },
        'Add trusted fingerprint',
        h(HelpTip, { text: 'Paste a peer fingerprint from the Known Peers list to grant elevated actions.' })
      ),
      h('div', { className: 'flex gap-2 mb-3' },
        h('input', {
          type: 'text',
          value: trustInput,
          onChange: e => setTrustInput(e.target.value),
          placeholder: 'fingerprint (e.g. abcd:1234:...)',
          className: `flex-1 px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
        }),
        h('button', { onClick: addTrusted, className: 'px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm rounded-lg font-medium transition-colors' }, 'Add')
      ),
      h('div', { className: 'space-y-2' },
        (settings.security?.trustedElevated || []).map(fp =>
          h('div', { key: fp, className: `flex items-center justify-between rounded-lg px-3 py-2 text-xs border ${isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}` },
            h('span', { className: 'font-mono break-all' }, fp),
            h('button', { onClick: () => removeTrusted(fp), className: 'text-red-400 hover:text-red-300 text-xs' }, 'Remove')
          )
        ),
        (!settings.security?.trustedElevated || settings.security.trustedElevated.length === 0) &&
          h('div', { className: `text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'No trusted elevated peers yet.')
      ),
      knownPeers?.length > 0 && h('div', { className: 'mt-4' },
        h('div', { className: `text-xs mb-2 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Known peers:'),
        h('div', { className: 'space-y-2' },
          knownPeers.map(p =>
            h('div', { key: p.publicKeyFingerprint, className: `flex items-center justify-between rounded-lg px-3 py-2 text-xs border ${isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}` },
              h('div', null,
                h('div', { className: 'font-medium' }, p.displayName || p.peerId || 'Peer'),
                h('div', { className: 'font-mono break-all' }, p.publicKeyFingerprint)
              ),
              h('button', { onClick: () => setTrustInput(p.publicKeyFingerprint), className: 'text-brand-400 hover:text-brand-300 text-xs' }, 'Use')
            )
          )
        )
      )
    ),

    // Governance
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4' }, 'Governance Controls'),
      h('div', { className: 'space-y-4' },
        h('div', null,
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Vote Threshold (weight)', h(HelpTip, { text: 'Total vote weight required before auto-quarantine.' })),
          h('input', {
            type: 'number',
            min: 1,
            max: 10,
            value: settings.security?.voteThreshold ?? 2,
            onChange: e => updateVoteThreshold(e.target.value),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          }),
          h('div', { className: `text-[11px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Higher values require more (or higher reputation) votes to quarantine. Local-only; not shared across peers.')
        ),
        h('div', null,
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Quarantined Peers', h(HelpTip, { text: 'Quarantined peers are blocked from inbound traffic.' })),
          (settings.security?.quarantinedPeers || []).length === 0 ?
            h('div', { className: `text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'No quarantined peers.') :
            h('div', { className: 'space-y-2' },
              (settings.security?.quarantinedPeers || []).map(pid =>
                h('div', { key: pid, className: `flex items-center justify-between rounded-lg px-3 py-2 text-xs border ${isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}` },
                  h('span', { className: 'font-mono break-all' }, pid),
                  h('button', { onClick: () => releaseQuarantine(pid), className: 'text-emerald-400 hover:text-emerald-300 text-xs' }, 'Release')
                )
              )
            )
        )
      )
    ),

    // Sybil resistance
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4' }, 'Sybil Resistance (Proof of Work)'),
      h('div', { className: 'flex items-center justify-between mb-3' },
        h('div', null,
        h('div', { className: 'text-sm' }, 'Require PoW for new peers', h(HelpTip, { text: 'Requires proof-of-work from unknown peers before accepting them.' })),
          h('div', { className: `text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Unknown peers must present a PoW token on hello. Higher difficulty means slower joins.')
        ),
        h('button', {
          onClick: () => setSettings(s => ({
            ...s,
            security: { ...s.security, pow: { ...(s.security?.pow || { enabled: false, difficulty: 3 }), enabled: !(s.security?.pow?.enabled) } }
          })),
          className: `w-12 h-6 rounded-full transition-colors relative ${settings.security?.pow?.enabled ? 'bg-brand-500' : isDark ? 'bg-slate-700' : 'bg-slate-300'}`
        },
          h('div', {
            className: 'w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all shadow',
            style: { left: settings.security?.pow?.enabled ? 26 : 2 }
          })
        )
      ),
      h('div', null,
        h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Difficulty (leading zeros)', h(HelpTip, { text: 'Higher values increase the cost of joining for new peers.' })),
        h('input', {
          type: 'number',
          min: 1,
          max: 6,
          value: settings.security?.pow?.difficulty ?? 3,
          onChange: e => setSettings(s => ({
            ...s,
            security: {
              ...s.security,
              pow: { ...(s.security?.pow || { enabled: false, difficulty: 3 }), difficulty: Math.max(1, Math.min(6, Number(e.target.value) || 1)) }
            }
          })),
          className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
        }),
        h('div', { className: `text-[11px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Higher difficulty slows joins. Keep low for demo.')
      )
    ),

    // Policy sync
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4' }, 'Policy Synchronization', h(HelpTip, { text: 'Signed proposals you can accept or reject locally.' })),
      h('div', { className: `text-xs mb-4 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Share your local policy set or accept proposals from peers. Accepting applies their security/SLA/sync policy locally.'),
      h('div', { className: 'flex flex-wrap gap-2 mb-4' },
        h('button', { onClick: onSendPolicy, className: 'px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm rounded-lg font-medium transition-colors' }, 'Share Policy')
      ),
      (pendingPolicies || []).length === 0 ?
        h('div', { className: `text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'No pending policy proposals.') :
        h('div', { className: 'space-y-2' },
          pendingPolicies.map(p =>
            h('div', { key: p.id, className: `rounded-lg px-3 py-2 text-xs border ${isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}` },
              h('div', { className: 'flex items-center justify-between gap-2' },
                h('div', null,
                  h('div', { className: 'font-medium' }, p.signer?.peerId || 'Peer'),
                  h('div', { className: 'font-mono break-all' }, p.signer?.fingerprint || 'unknown')
                ),
                h('div', { className: 'flex gap-2' },
                  h('button', { onClick: () => onAcceptPolicy?.(p), className: 'text-emerald-400 hover:text-emerald-300 text-xs' }, 'Accept'),
                  h('button', { onClick: () => onRejectPolicy?.(p), className: 'text-red-400 hover:text-red-300 text-xs' }, 'Reject')
                )
              )
            )
          )
        )
    ),

    // Sync preferences
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4' }, 'Sync Preferences', h(HelpTip, { text: 'Controls what your snapshots include and who you send to.' })),
      h('div', { className: `text-xs mb-4 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Limit snapshots to reduce bandwidth. These settings only affect what you send.'),
      h('div', null,
        h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Scope', h(HelpTip, { text: 'Limits snapshot content to all tickets or just those you own/are assigned.' })),
        h('select', {
          value: settings.sync?.scope || 'all',
          onChange: e => setSettings(s => ({ ...s, sync: { ...s.sync, scope: e.target.value } })),
          className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
        },
          h('option', { value: 'all' }, 'All tickets'),
          h('option', { value: 'assigned' }, 'Assigned to me'),
          h('option', { value: 'own' }, 'Assigned or owned by me')
        ),
        h('div', { className: `text-[11px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Limits which tickets/events are included in snapshots.')
      ),
      h('div', { className: 'mt-3' },
        h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Recent Events Window (minutes)', h(HelpTip, { text: 'Only include events newer than this window.' })),
        h('input', {
          type: 'number',
          min: 0,
          value: settings.sync?.recentMinutes || 0,
          onChange: e => setSettings(s => ({ ...s, sync: { ...s.sync, recentMinutes: Math.max(0, Number(e.target.value) || 0) } })),
          className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
        }),
        h('div', { className: `text-[11px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Set to 0 for full bounded history.')
      ),
      h('div', { className: 'mt-3' },
        h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Ticket IDs (comma-separated)', h(HelpTip, { text: 'Restrict snapshots to specific ticket IDs.' })),
        h('input', {
          type: 'text',
          value: (settings.sync?.ticketIds || []).join(', '),
          onChange: e => {
            const ids = (e.target.value || '').split(',').map(s => s.trim()).filter(Boolean);
            setSettings(s => ({ ...s, sync: { ...s.sync, ticketIds: ids } }));
          },
          placeholder: '#abc123, #def456',
          className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
        }),
        h('div', { className: `text-[11px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Limit snapshot sync to specific tickets.')
      ),
      h('div', { className: 'mt-3 grid grid-cols-1 md:grid-cols-2 gap-3' },
        h('div', null,
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Compression', h(HelpTip, { text: 'Gzip reduces bandwidth if supported by your browser.' })),
          h('select', {
            value: settings.sync?.compression || 'none',
            onChange: e => setSettings(s => ({ ...s, sync: { ...s.sync, compression: e.target.value } })),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          },
            h('option', { value: 'none' }, 'None'),
            h('option', { value: 'gzip' }, 'Gzip (if supported)')
          )
        ),
        h('div', null,
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Max Peers per Sync', h(HelpTip, { text: 'Limit how many peers receive each snapshot.' })),
          h('input', {
            type: 'number',
            min: 0,
            value: settings.sync?.maxPeers || 0,
            onChange: e => setSettings(s => ({ ...s, sync: { ...s.sync, maxPeers: Math.max(0, Number(e.target.value) || 0) } })),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          }),
          h('div', { className: `text-[11px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, '0 = all peers.')
        )
      ),
      h('div', { className: 'mt-3 flex items-center justify-between' },
        h('div', null,
          h('div', { className: 'text-sm' }, 'Prefer High-Reputation Peers', h(HelpTip, { text: 'Prioritize higher reputation peers when selecting sync targets.' })),
          h('div', { className: `text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Prioritize peers with better reputation for sync.')
        ),
        h('button', {
          onClick: () => setSettings(s => ({ ...s, sync: { ...s.sync, preferReputation: !s.sync?.preferReputation } })),
          className: `w-12 h-6 rounded-full transition-colors relative ${settings.sync?.preferReputation ? 'bg-brand-500' : isDark ? 'bg-slate-700' : 'bg-slate-300'}`
        },
          h('div', {
            className: 'w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all shadow',
            style: { left: settings.sync?.preferReputation ? 26 : 2 }
          })
        )
      )
    ),

    // Theme
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4' }, 'Appearance'),
      h('div', { className: 'flex items-center justify-between' },
        h('span', { className: 'text-sm' }, 'Dark Mode', h(HelpTip, { text: 'Toggles light/dark theme locally.' })),
        h('button', {
          onClick: () => setSettings(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' })),
          className: `w-12 h-6 rounded-full transition-colors relative ${isDark ? 'bg-brand-500' : 'bg-slate-300'}`
        },
          h('div', {
            className: 'w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all shadow',
            style: { left: isDark ? 26 : 2 }
          })
        )
      )
    ),

    // Simulation
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4' }, 'Simulation'),
      h('div', { className: 'flex items-center justify-between' },
        h('div', null,
          h('div', { className: 'text-sm' }, 'Demo Mode', h(HelpTip, { text: 'Simulates activity and network events for demos.' })),
          h('div', { className: `text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Generates simulated activity and network events.')
        ),
        h('button', {
          onClick: () => setSettings(s => ({ ...s, demoMode: !s.demoMode })),
          className: `w-12 h-6 rounded-full transition-colors relative ${settings.demoMode ? 'bg-brand-500' : isDark ? 'bg-slate-700' : 'bg-slate-300'}`
        },
          h('div', {
            className: 'w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all shadow',
            style: { left: settings.demoMode ? 26 : 2 }
          })
        )
      )
    ),

    // PeerJS signaling
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4' }, 'PeerJS Signaling'),
      h('div', { className: 'flex items-center justify-between mb-4' },
        h('div', null,
        h('div', { className: 'text-sm' }, 'Use Custom PeerJS Server', h(HelpTip, { text: 'Toggle to use your own PeerJS signaling server.' })),
          h('div', { className: `text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Defaults to the public PeerJS cloud.')
        ),
        h('button', {
          onClick: () => setSettings(s => ({
            ...s,
            peerServer: { ...s.peerServer, useCustom: !s.peerServer?.useCustom }
          })),
          className: `w-12 h-6 rounded-full transition-colors relative ${settings.peerServer?.useCustom ? 'bg-brand-500' : isDark ? 'bg-slate-700' : 'bg-slate-300'}`
        },
          h('div', {
            className: 'w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all shadow',
            style: { left: settings.peerServer?.useCustom ? 26 : 2 }
          })
        )
      ),
      h('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-3' },
        h('div', null,
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Host', h(HelpTip, { text: 'PeerJS host name or IP.' })),
          h('input', {
            type: 'text',
            value: settings.peerServer?.host || '',
            onChange: e => setSettings(s => ({ ...s, peerServer: { ...s.peerServer, host: e.target.value } })),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', null,
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Port', h(HelpTip, { text: 'PeerJS server port.' })),
          h('input', {
            type: 'number',
            value: settings.peerServer?.port ?? 9000,
            onChange: e => setSettings(s => ({ ...s, peerServer: { ...s.peerServer, port: Number(e.target.value) } })),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', null,
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Path', h(HelpTip, { text: 'PeerJS server path, e.g. /peerjs.' })),
          h('input', {
            type: 'text',
            value: settings.peerServer?.path || '/peerjs',
            onChange: e => setSettings(s => ({ ...s, peerServer: { ...s.peerServer, path: e.target.value } })),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', { className: 'flex items-center gap-3' },
          h('button', {
            onClick: () => setSettings(s => ({
              ...s,
              peerServer: { ...s.peerServer, secure: !s.peerServer?.secure }
            })),
            className: `w-12 h-6 rounded-full transition-colors relative ${settings.peerServer?.secure ? 'bg-brand-500' : isDark ? 'bg-slate-700' : 'bg-slate-300'}`
          },
            h('div', {
              className: 'w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all shadow',
              style: { left: settings.peerServer?.secure ? 26 : 2 }
            })
          ),
          h('span', { className: 'text-sm' }, 'Secure (wss)', h(HelpTip, { text: 'Enable TLS for secure websocket connections.' }))
        )
      )
    ),

    // TURN
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4' }, 'TURN Relay'),
      h('div', { className: 'flex items-center justify-between mb-4' },
        h('div', null,
        h('div', { className: 'text-sm' }, 'Enable TURN', h(HelpTip, { text: 'Use a relay when direct peer connections fail.' })),
          h('div', { className: `text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Relays traffic when direct P2P fails.')
        ),
        h('button', {
          onClick: () => setSettings(s => ({
            ...s,
            turn: { ...s.turn, enabled: !s.turn?.enabled }
          })),
          className: `w-12 h-6 rounded-full transition-colors relative ${settings.turn?.enabled ? 'bg-brand-500' : isDark ? 'bg-slate-700' : 'bg-slate-300'}`
        },
          h('div', {
            className: 'w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all shadow',
            style: { left: settings.turn?.enabled ? 26 : 2 }
          })
        )
      ),
      h('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-3' },
        h('div', null,
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'TURN Host', h(HelpTip, { text: 'TURN server hostname or IP.' })),
          h('input', {
            type: 'text',
            value: settings.turn?.host || '',
            onChange: e => setSettings(s => ({ ...s, turn: { ...s.turn, host: e.target.value } })),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', null,
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'TURN Port', h(HelpTip, { text: 'TURN server port (usually 3478).' })),
          h('input', {
            type: 'number',
            value: settings.turn?.port ?? 3478,
            onChange: e => setSettings(s => ({ ...s, turn: { ...s.turn, port: Number(e.target.value) } })),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', null,
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Username', h(HelpTip, { text: 'TURN username from your server config.' })),
          h('input', {
            type: 'text',
            value: settings.turn?.username || '',
            onChange: e => setSettings(s => ({ ...s, turn: { ...s.turn, username: e.target.value } })),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', null,
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Credential', h(HelpTip, { text: 'TURN credential/password.' })),
          h('input', {
            type: 'password',
            value: settings.turn?.credential || '',
            onChange: e => setSettings(s => ({ ...s, turn: { ...s.turn, credential: e.target.value } })),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', { className: 'flex items-center gap-3' },
          h('button', {
            onClick: () => setSettings(s => ({
              ...s,
              turn: { ...s.turn, useTLS: !s.turn?.useTLS }
            })),
            className: `w-12 h-6 rounded-full transition-colors relative ${settings.turn?.useTLS ? 'bg-brand-500' : isDark ? 'bg-slate-700' : 'bg-slate-300'}`
          },
            h('div', {
              className: 'w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all shadow',
              style: { left: settings.turn?.useTLS ? 26 : 2 }
            })
          ),
          h('span', { className: 'text-sm' }, 'Use TLS (turns)', h(HelpTip, { text: 'Enable TLS for TURN if configured on the server.' }))
        )
      )
    ),

    // Storage
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4' }, 'Local Storage'),
      h('div', { className: 'space-y-2 text-sm mb-4' },
        h('div', { className: 'flex justify-between' },
          h('span', { className: isDark ? 'text-slate-400' : 'text-slate-500' }, 'Total Events'),
          h('span', { className: 'font-mono' }, state.events.length)
        ),
        h('div', { className: 'flex justify-between' },
          h('span', { className: isDark ? 'text-slate-400' : 'text-slate-500' }, 'Total Tickets'),
          h('span', { className: 'font-mono' }, state.tickets.length)
        ),
        h('div', { className: 'flex justify-between' },
          h('span', { className: isDark ? 'text-slate-400' : 'text-slate-500' }, 'Peers Known'),
          h('span', { className: 'font-mono' }, agents.length)
        )
      ),
      h('button', { onClick: handleClear, className: 'px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm rounded-lg font-medium transition-colors' }, 'Clear All Local Data')
    )
  );
}

// ============ CREATE TICKET MODAL ============
function CreateTicketModal({ onClose, onCreate, isDark, identity }) {
  const [customer, setCustomer] = useState('');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('Technical');
  const [priority, setPriority] = useState('Medium');
  const [message, setMessage] = useState('');
  const isCustomer = identity?.role === 'Customer';

  useEffect(() => {
    if (isCustomer && identity?.displayName) setCustomer(identity.displayName);
  }, [identity, isCustomer]);

  const canSubmit = (isCustomer ? true : customer.trim()) && subject.trim() && message.trim();

  return h('div', { className: 'fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm', onClick: onClose },
    h('div', {
      className: `w-full max-w-lg mx-4 rounded-2xl border p-6 animate-fade-in ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`,
      onClick: e => e.stopPropagation()
    },
      h('div', { className: 'flex items-center justify-between mb-5' },
        h('h2', { className: 'text-lg font-semibold' }, 'Create New Ticket'),
        h('button', { onClick: onClose, className: `p-1 rounded ${isDark ? 'hover:bg-slate-800 text-slate-500' : 'hover:bg-slate-100 text-slate-400'}` }, h(Icon, { name: 'close', size: 18 }))
      ),
      h('div', { className: 'space-y-4' },
        h('div', null,
          h('label', { className: `text-sm block mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}` }, 'Customer Name'),
          h('input', {
            type: 'text',
            value: customer,
            onChange: e => setCustomer(e.target.value),
            disabled: isCustomer,
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'} focus:outline-none focus:border-brand-500 ${isCustomer ? 'opacity-70 cursor-not-allowed' : ''}`
          })
        ),
        h('div', null,
          h('label', { className: `text-sm block mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}` }, 'Subject'),
          h('input', {
            type: 'text', value: subject, onChange: e => setSubject(e.target.value),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', { className: 'grid grid-cols-2 gap-3' },
          h('div', null,
            h('label', { className: `text-sm block mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}` }, 'Category'),
            h('select', {
              value: category, onChange: e => setCategory(e.target.value),
              className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
            }, CATEGORIES.map(c => h('option', { key: c, value: c }, c)))
          ),
          h('div', null,
            h('label', { className: `text-sm block mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}` }, 'Priority'),
            h('select', {
              value: priority, onChange: e => setPriority(e.target.value),
              className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
            }, PRIORITIES.map(p => h('option', { key: p, value: p }, p)))
          )
        ),
        h('div', null,
          h('label', { className: `text-sm block mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}` }, 'Initial Message'),
          h('textarea', {
            value: message, onChange: e => setMessage(e.target.value), rows: 3,
            className: `w-full px-3 py-2 text-sm rounded-lg border resize-none ${isDark ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', { className: 'flex gap-2 pt-2' },
          h('button', { onClick: onClose, className: `flex-1 py-2 text-sm rounded-lg font-medium transition-colors ${isDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}` }, 'Cancel'),
          h('button', {
            onClick: () => canSubmit && onCreate({ customer, subject, category, priority, message }),
            disabled: !canSubmit,
            className: `flex-1 py-2 text-sm rounded-lg font-medium transition-colors ${canSubmit ? 'bg-brand-500 hover:bg-brand-600 text-white' : isDark ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`
          }, 'Create Ticket')
        )
      )
    )
  );
}

// ============ RENDER ============
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(h(App));
