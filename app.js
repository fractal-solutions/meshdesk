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
const genFingerprint = () => Array.from({length:8}, () => Math.random().toString(16).substr(2,4)).join(':');
const genAvatar = (seed) => {
  const colors = ['#6366F1','#EC4899','#10B981','#F59E0B','#3B82F6','#8B5CF6','#EF4444','#14B8A6'];
  const c = colors[Math.abs(seed.split('').reduce((a,b) => a + b.charCodeAt(0), 0)) % colors.length];
  return c;
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
  return { tickets: [], events: [], meta: { version: 2 } };
}

// ============ LOAD/SAVE ============
function loadState() {
  try {
    const saved = localStorage.getItem('meshdesk_state');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.meta?.version === 2) return parsed;
      return null;
    }
  } catch(e) {}
  return null;
}

function saveState(state) {
  try {
    const toSave = { ...state, meta: { version: 2 } };
    localStorage.setItem('meshdesk_state', JSON.stringify(toSave));
  } catch(e) {}
}

function loadSettings() {
  const defaults = {
    theme: 'dark',
    sidebarCollapsed: false,
    demoMode: false,
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
    }
  };
  try {
    const s = localStorage.getItem('meshdesk_settings');
    if (s) {
      const parsed = JSON.parse(s);
      return {
        ...defaults,
        ...parsed,
        peerServer: { ...defaults.peerServer, ...(parsed.peerServer || {}) },
        turn: { ...defaults.turn, ...(parsed.turn || {}) }
      };
    }
  } catch(e) {}
  return defaults;
}

function saveSettings(s) {
  try { localStorage.setItem('meshdesk_settings', JSON.stringify(s)); } catch(e) {}
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
    if (new Date(t.updated).getTime() > new Date(existing.updated).getTime()) {
      byId.set(t.id, t);
    }
  }
  return Array.from(byId.values());
}

function mergeEvents(local, incoming) {
  const byId = new Map(local.map(e => [e.id, e]));
  for (const e of incoming || []) {
    if (!byId.has(e.id)) byId.set(e.id, e);
  }
  return Array.from(byId.values()).sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 200);
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
  const [peerRestartNonce, setPeerRestartNonce] = useState(0);
  const peerRef = useRef(null);
  const connsRef = useRef(new Map());
  const stateRef = useRef(state);
  const suppressBroadcastRef = useRef(false);
  const seenEventsRef = useRef(new Set());

  const isDark = settings.theme === 'dark';

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  useEffect(() => { saveState(state); }, [state]);
  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => {
    const cache = seenEventsRef.current;
    for (const e of state.events) cache.add(e.id);
  }, [state.events]);

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

  const handleCreateIdentity = (name, role) => {
    const id = {
      peerId: genId(),
      publicKeyFingerprint: genFingerprint(),
      displayName: name || 'Agent ' + genId().substring(0, 4),
      role: role || 'L1',
      status: 'Online',
      createdAt: new Date().toISOString()
    };
    setIdentity(id);
    saveIdentity(id);
    setShowOnboarding(false);
  };

  const logSync = useCallback((msg, type = 'info') => {
    const entry = { id: genId(), ts: new Date().toISOString(), msg, type };
    setSyncLog(prev => [entry, ...prev].slice(0, 80));
  }, []);

  const updateConnectionsState = useCallback(() => {
    const list = Array.from(connsRef.current.values()).map(conn => ({
      peerId: conn.peer,
      open: conn.open
    }));
    setConnections(list);
    setNetworkStatus(list.length > 0 ? 'connected' : 'idle');
  }, []);

  const broadcast = useCallback((payload) => {
    if (suppressBroadcastRef.current) return;
    connsRef.current.forEach(conn => {
      if (conn.open) {
        try { conn.send(payload); } catch (e) {}
      }
    });
  }, []);

  const sendSnapshot = useCallback((conn) => {
    const snapshot = {
      tickets: stateRef.current.tickets,
      events: stateRef.current.events
    };
    try {
      conn.send({ type: 'snapshot', snapshot });
      logSync(`Snapshot sent to ${conn.peer}`);
    } catch (e) {
      logSync(`Snapshot failed to ${conn.peer}`, 'error');
    }
  }, [logSync]);

  const sendSnapshotToAll = useCallback(() => {
    let sent = 0;
    connsRef.current.forEach(conn => {
      if (conn.open) {
        sendSnapshot(conn);
        sent++;
      }
    });
    if (!sent) logSync('No open connections to sync', 'warning');
  }, [sendSnapshot]);

  const applySnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    suppressBroadcastRef.current = true;
    setState(prev => ({
      ...prev,
      tickets: mergeTickets(prev.tickets, snapshot.tickets),
      events: mergeEvents(prev.events, snapshot.events)
    }));
    setTimeout(() => { suppressBroadcastRef.current = false; }, 0);
  }, []);

  const applyEvent = useCallback((payload) => {
    if (!payload?.event) return;
    const evt = payload.event;
    if (seenEventsRef.current.has(evt.id)) return;
    seenEventsRef.current.add(evt.id);
    suppressBroadcastRef.current = true;
    setState(prev => {
      let tickets = prev.tickets;
      if (payload.ticket) {
        const existing = prev.tickets.find(t => t.id === payload.ticket.id);
        if (!existing) {
          tickets = [payload.ticket, ...prev.tickets];
        } else if (new Date(payload.ticket.updated).getTime() >= new Date(existing.updated).getTime()) {
          tickets = prev.tickets.map(t => t.id === payload.ticket.id ? payload.ticket : t);
        }
      }
      const events = [evt, ...prev.events.filter(e => e.id !== evt.id)].slice(0, 200);
      return { ...prev, tickets, events };
    });
    setTimeout(() => { suppressBroadcastRef.current = false; }, 0);
  }, []);

  const emitEvent = useCallback((event, ticket) => {
    if (!event) return;
    seenEventsRef.current.add(event.id);
    broadcast({ type: 'event', event, ticket });
    // Fallback to full snapshot to keep peers consistent if an event is dropped.
    sendSnapshotToAll();
  }, [broadcast, sendSnapshotToAll]);

  const setupConnection = useCallback((conn) => {
    connsRef.current.set(conn.peer, conn);
    updateConnectionsState();
    logSync(`Connected to ${conn.peer}`);

    const handleOpen = () => {
      updateConnectionsState();
      logSync(`Connection open with ${conn.peer}`);
      try { conn.send({ type: 'hello', from: peerId }); } catch (e) {}
      sendSnapshot(conn);
    };
    conn.on('open', handleOpen);
    conn.on('data', (data) => {
      if (!data || !data.type) return;
      if (data.type === 'hello') {
        logSync(`Hello from ${conn.peer}`);
        sendSnapshot(conn);
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
        sendSnapshot(conn);
      }
      if (data.type === 'snapshot') {
        applySnapshot(data.snapshot);
        logSync(`Snapshot synced with ${conn.peer}`);
        setGossipRound(prev => prev + 1);
      }
      if (data.type === 'event') {
        applyEvent(data);
        logSync(`Event synced with ${conn.peer}`);
        setGossipRound(prev => prev + 1);
      }
    });
    conn.on('close', () => {
      connsRef.current.delete(conn.peer);
      updateConnectionsState();
      logSync(`Disconnected from ${conn.peer}`, 'warning');
    });
    conn.on('error', () => {
      logSync(`Connection error with ${conn.peer}`, 'error');
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
  }, [applyEvent, applySnapshot, logSync, peerId, sendSnapshot, updateConnectionsState]);

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
    if (!identity) return;
    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch (e) {}
      peerRef.current = null;
      connsRef.current.clear();
      updateConnectionsState();
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
        peer = new Peer(identity.peerId, {
          debug: 1,
          host: server.host,
          port: Number(server.port),
          path: server.path,
          secure: !!server.secure,
          config: { iceServers }
        });
      } else {
        peer = new Peer(identity.peerId, { debug: 1, config: { iceServers } });
      }
    } catch (e) {
      setPeerStatus('error');
      logSync('Failed to initialize PeerJS', 'error');
      return;
    }
    peerRef.current = peer;

    peer.on('open', (id) => {
      setPeerStatus('online');
      setPeerId(id);
      if (identity.peerId !== id) {
        const updated = { ...identity, peerId: id };
        setIdentity(updated);
        saveIdentity(updated);
      }
      updateConnectionsState();
      logSync(`Peer ready: ${id}`);
    });
    peer.on('connection', (conn) => {
      setupConnection(conn);
    });
    peer.on('disconnected', () => {
      setPeerStatus('offline');
      setNetworkStatus('idle');
    });
    peer.on('close', () => {
      setPeerStatus('offline');
      setNetworkStatus('idle');
    });
    peer.on('error', (err) => {
      setPeerStatus('error');
      logSync(`Peer error: ${err?.type || 'unknown'}`, 'error');
      if (err?.type === 'unavailable-id') {
        const newId = genId();
        const updated = { ...identity, peerId: newId };
        setIdentity(updated);
        saveIdentity(updated);
      }
    });

    return () => {
      try { peer.destroy(); } catch (e) {}
      peerRef.current = null;
      connsRef.current.clear();
      updateConnectionsState();
    };
  }, [identity, logSync, setupConnection, updateConnectionsState, settings?.peerServer, settings?.turn, peerRestartNonce]);

  const isCustomer = identity?.role === 'Customer';

  const handleCreateTicket = (ticket) => {
    const now = new Date().toISOString();
    const customerName = isCustomer ? identity.displayName : ticket.customer;
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
      replicationCount: 1,
      tags: []
    };
    const evt = { id: genId(), type: 'TicketCreated', ticketId: newTicket.id, actor: customerName, ts: now, detail: ticket.subject };
    setState(prev => ({
      ...prev,
      tickets: [newTicket, ...prev.tickets],
      events: [evt, ...prev.events]
    }));
    emitEvent(evt, newTicket);
    setShowCreateModal(false);
  };

  const handleClaimTicket = (ticketId) => {
    if (!identity) return;
    const now = new Date().toISOString();
    const base = stateRef.current.tickets.find(t => t.id === ticketId);
    if (!base) return;
    const updatedTicket = { ...base, agent: identity.displayName, status: 'In Progress', updated: now };
    const evt = { id: genId(), type: 'TicketAssigned', ticketId, actor: identity.displayName, ts: now, detail: `Claimed by ${identity.displayName}` };
    setState(prev => ({
      ...prev,
      tickets: prev.tickets.map(t => t.id === ticketId ? updatedTicket : t),
      events: [evt, ...prev.events]
    }));
    emitEvent(evt, updatedTicket);
  };

  const handleEscalateTicket = (ticketId) => {
    const now = new Date().toISOString();
    const base = stateRef.current.tickets.find(t => t.id === ticketId);
    if (!base) return;
    const currentLevelIdx = ROLES.indexOf(base.escalationLevel || 'L1');
    const nextLevel = ROLES[Math.min(currentLevelIdx + 1, ROLES.length - 1)];
    const updatedTicket = { ...base, status: 'Escalated', escalationLevel: nextLevel, updated: now };
    const evt = { id: genId(), type: 'TicketEscalated', ticketId, actor: identity?.displayName || 'System', ts: now, detail: `Escalated to ${nextLevel}` };
    setState(prev => {
      return {
        ...prev,
        tickets: prev.tickets.map(t => t.id === ticketId ? updatedTicket : t),
        events: [evt, ...prev.events]
      };
    });
    emitEvent(evt, updatedTicket);
  };

  const handleResolveTicket = (ticketId) => {
    const now = new Date().toISOString();
    const base = stateRef.current.tickets.find(t => t.id === ticketId);
    if (!base) return;
    const updatedTicket = { ...base, status: 'Resolved', updated: now };
    const evt = { id: genId(), type: 'TicketResolved', ticketId, actor: identity?.displayName || 'System', ts: now, detail: 'Ticket resolved' };
    setState(prev => ({
      ...prev,
      tickets: prev.tickets.map(t => t.id === ticketId ? updatedTicket : t),
      events: [evt, ...prev.events]
    }));
    emitEvent(evt, updatedTicket);
  };

  const handleSendMessage = (ticketId, text) => {
    if (!text.trim()) return;
    const now = new Date().toISOString();
    const isCustomerSender = identity?.role === 'Customer';
    const msg = { id: genId(), type: isCustomerSender ? 'customer' : 'agent', sender: identity?.displayName || 'You', text, ts: now };
    const base = stateRef.current.tickets.find(t => t.id === ticketId);
    if (!base) return;
    const updatedTicket = { ...base, messages: [...base.messages, msg], updated: now };
    const evt = { id: genId(), type: 'MessageSent', ticketId, actor: identity?.displayName || 'You', ts: now, detail: text.substring(0, 60) };
    setState(prev => ({
      ...prev,
      tickets: prev.tickets.map(t => t.id === ticketId ? updatedTicket : t),
      events: [evt, ...prev.events]
    }));
    emitEvent(evt, updatedTicket);
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
      list.push({
        id: c.peerId,
        name: 'Peer ' + (i + 1),
        role: 'L1',
        status: c.open ? 'Online' : 'Offline',
        avatar: '#3B82F6',
        peerId: c.peerId
      });
    });
    return list;
  }, [connections, identity]);

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

  const visibleTickets = useMemo(() => {
    if (!identity) return state.tickets;
    if (identity.role === 'Customer') {
      return state.tickets.filter(t => t.customerPeerId === identity.peerId);
    }
    return state.tickets;
  }, [identity, state.tickets]);

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
            onResolve: handleResolveTicket, onSendMessage: handleSendMessage,
            identity, setShowCreateModal
          }),
          view === 'chat' && h(ChatView, { tickets: visibleTickets, isDark, identity, onSendMessage: handleSendMessage, selectedTicketId, setSelectedTicketId }),
          view === 'agents' && h(AgentsView, { agents: agentsList, tickets: state.tickets, isDark }),
          view === 'escalations' && h(EscalationsView, { state, isDark, onClaim: handleClaimTicket, identity }),
          view === 'network' && h(NetworkView, {
            state, isDark, gossipRound, syncLog, identity,
            peerStatus, peerId, connections, connectTarget, setConnectTarget,
            onConnectPeer: connectToPeer, onDisconnectPeer: disconnectPeer, onSyncNow: sendSnapshotToAll,
            onRequestSnapshot: requestSnapshotFromPeer, onPingPeer: pingPeer, onReconnectPeerJS: reconnectPeerJS
          }),
          view === 'settings' && h(SettingsView, { identity, setIdentity, settings, setSettings, isDark, state, agents: agentsList })
        ),

        // Footer
        h('footer', { className: `h-8 flex items-center justify-center border-t text-xs flex-shrink-0 ${isDark ? 'bg-slate-900 border-slate-800 text-slate-500' : 'bg-white border-slate-200 text-slate-400'}` },
          'Powered by MeshDesk — Decentralized Support · ',
          h('a', { href: '/remix', className: 'text-brand-500 hover:text-brand-400 ml-1' }, 'Remix on Berrry')
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
  const [fingerprint] = useState(genFingerprint());

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
          h('div', { className: 'font-mono text-sm text-brand-400 break-all' }, fingerprint)
        ),
        h('button', {
          onClick: () => setStep(1),
          className: 'w-full py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-medium transition-colors text-sm'
        }, 'Generate Identity →')
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
          onClick: () => onComplete(name, role),
          disabled: !name.trim(),
          className: `w-full py-2.5 rounded-lg font-medium transition-colors text-sm ${name.trim() ? 'bg-brand-500 hover:bg-brand-600 text-white' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`
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
          state.events.slice(0, 30).map((evt, i) => {
            const evtColors = {
              'TicketCreated': 'text-blue-400', 'TicketAssigned': 'text-indigo-400', 'TicketEscalated': 'text-red-400',
              'TicketResolved': 'text-emerald-400', 'MessageSent': 'text-slate-400', 'AgentStatus': 'text-amber-400'
            };
            const dividerClass = isDark ? 'divide-slate-700/50' : 'divide-slate-100';
            return h('div', {
              key: evt.id,
              className: `px-5 py-3 flex items-start gap-3 text-sm animate-fade-in ${isDark ? 'hover:bg-slate-700/20' : 'hover:bg-slate-50'} transition-colors cursor-default`,
              style: { animationDelay: i * 30 + 'ms', animationFillMode: 'both' }
            },
              h('span', { className: `mt-0.5 ${evtColors[evt.type] || 'text-slate-400'}` },
                h(Icon, { name: evt.type === 'TicketCreated' ? 'ticket' : evt.type === 'TicketAssigned' ? 'claim' : evt.type === 'TicketEscalated' ? 'escalation' : evt.type === 'TicketResolved' ? 'check' : evt.type === 'MessageSent' ? 'chat' : 'users', size: 14 })
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
function TicketsView({ tickets, selectedTicketId, setSelectedTicketId, searchQuery, setSearchQuery, filterStatus, setFilterStatus, filterPriority, setFilterPriority, isDark, onClaim, onEscalate, onResolve, onSendMessage, identity, setShowCreateModal }) {
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
      onClaim, onEscalate, onResolve, onSendMessage, identity,
      setState: null
    })
  );
}

// ============ TICKET DETAIL PANEL ============
function TicketDetailPanel({ ticket, isDark, onClose, onClaim, onEscalate, onResolve, onSendMessage, identity }) {
  const [msgInput, setMsgInput] = useState('');
  const msgsEndRef = useRef(null);
  const bg = isDark ? 'bg-slate-800/80 border-slate-700/50' : 'bg-white border-slate-200';

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ticket.messages.length]);

  return h('div', { className: `w-full lg:w-[440px] xl:w-[500px] flex flex-col border-l animate-slide-in ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'}` },
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
        identity?.role !== 'Customer' && !ticket.agent && h('button', {
          onClick: () => onClaim(ticket.id),
          className: 'px-2.5 py-1 text-xs bg-brand-500 hover:bg-brand-600 text-white rounded-md font-medium transition-colors'
        }, 'Claim'),
        identity?.role !== 'Customer' && ticket.status !== 'Escalated' && ticket.status !== 'Resolved' && ticket.status !== 'Closed' && h('button', {
          onClick: () => onEscalate(ticket.id),
          className: `px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${isDark ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-red-50 text-red-600 hover:bg-red-100'}`
        }, 'Escalate'),
        identity?.role !== 'Customer' && ticket.status !== 'Resolved' && ticket.status !== 'Closed' && h('button', {
          onClick: () => onResolve(ticket.id),
          className: `px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${isDark ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`
        }, 'Resolve'),
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
      ticket.messages.map((msg, i) =>
        h('div', {
          key: msg.id,
          className: `flex ${msg.type === 'agent' ? 'justify-end' : 'justify-start'} animate-fade-in`,
          style: { animationDelay: i * 50 + 'ms', animationFillMode: 'both' }
        },
          h('div', {
            className: `max-w-[85%] rounded-xl px-4 py-2.5 ${
              msg.type === 'agent'
                ? 'bg-brand-500 text-white rounded-br-sm'
                : isDark ? 'bg-slate-800 text-slate-200 rounded-bl-sm' : 'bg-white text-slate-800 border border-slate-200 rounded-bl-sm'
            }`
          },
            h('div', { className: `text-xs font-medium mb-1 ${msg.type === 'agent' ? 'text-brand-200' : isDark ? 'text-slate-400' : 'text-slate-500'}` }, msg.sender),
            h('div', { className: 'text-sm leading-relaxed' }, msg.text),
            h('div', { className: `text-xs mt-1 ${msg.type === 'agent' ? 'text-brand-300' : isDark ? 'text-slate-600' : 'text-slate-400'}` }, timeAgo(msg.ts))
          )
        )
      ),
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
        onClaim: () => {}, onEscalate: () => {}, onResolve: () => {}, onSendMessage, identity
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
function AgentsView({ agents, tickets, isDark }) {
  const bg = isDark ? 'bg-slate-800/50 border-slate-700/50' : 'bg-white border-slate-200';

  return h('div', { className: 'flex-1 overflow-y-auto p-6' },
    agents.length === 0 ?
      h('div', { className: `rounded-xl border ${bg} p-8 text-center` },
        h(Icon, { name: 'users', size: 32, className: 'mx-auto text-slate-400 mb-2' }),
        h('p', { className: isDark ? 'text-slate-400' : 'text-slate-500' }, 'No peers connected')
      ) :
      h('div', { className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4' },
        agents.map((agent, i) =>
          h('div', {
            key: agent.id,
            className: `rounded-xl border p-5 ${bg} animate-fade-in`,
            style: { animationDelay: i * 60 + 'ms', animationFillMode: 'both' }
          },
            h('div', { className: 'flex items-center gap-3 mb-4' },
              h('div', { className: 'relative' },
                h('div', {
                  className: 'w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold',
                  style: { backgroundColor: agent.avatar }
                }, agent.name.split(' ').map(n => n[0]).join('')),
                h('span', {
                  className: 'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2',
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
            )
          )
        )
      )
  );
}

// ============ ESCALATIONS VIEW ============
function EscalationsView({ state, isDark, onClaim, identity }) {
  const escalated = state.tickets.filter(t => t.status === 'Escalated');
  const bg = isDark ? 'bg-slate-800/50 border-slate-700/50' : 'bg-white border-slate-200';

  const rules = [
    { text: 'Auto-escalate after 10 minutes unassigned', enabled: true },
    { text: 'Escalate Critical tickets to L2 immediately', enabled: true },
    { text: 'Alert Supervisor if ticket unresolved after 30 minutes', enabled: false },
    { text: 'Notify all agents on Critical escalation', enabled: true },
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
function NetworkView({ state, isDark, gossipRound, syncLog, identity, peerStatus, peerId, connections, connectTarget, setConnectTarget, onConnectPeer, onDisconnectPeer, onSyncNow, onRequestSnapshot, onPingPeer, onReconnectPeerJS }) {
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
      p.push({
        id: c.peerId,
        name: 'Peer ' + (i + 1),
        role: 'L1',
        status: c.open ? 'Online' : 'Offline',
        tickets: 0,
        color: '#3B82F6',
        isSelf: false
      });
    });
    return p;
  }, [connections, identity]);

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

    if (peers.length === 0) {
      ctx.clearRect(0, 0, w, hh);
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

      // Draw edges
      const nodes = nodesRef.current;
      for (let i = 0; i < peers.length; i++) {
        for (let j = i + 1; j < peers.length; j++) {
          if (peers[i].status === 'Offline' || peers[j].status === 'Offline') continue;
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < 200) {
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = isDark ? `rgba(99,102,241,${0.15 * (1 - dist/200)})` : `rgba(99,102,241,${0.2 * (1 - dist/200)})`;
            ctx.lineWidth = 1;
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

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = peer.status === 'Offline' ? (isDark ? '#334155' : '#CBD5E1') : peer.color;
        ctx.globalAlpha = peer.status === 'Offline' ? 0.4 : 1;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Label
        ctx.font = '10px IBM Plex Sans';
        ctx.textAlign = 'center';
        ctx.fillStyle = isDark ? '#94A3B8' : '#64748B';
        ctx.fillText(peer.name.split(' ')[0], node.x, node.y + r + 14);

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
          connections.map(c =>
            h('div', {
              key: c.peerId,
              className: `flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`
            },
              h('div', { className: 'flex items-center gap-2' },
                h('span', { className: `w-2 h-2 rounded-full ${c.open ? 'bg-emerald-500' : 'bg-slate-500'}` }),
                h('span', { className: 'font-mono' }, c.peerId)
              ),
              h('div', { className: 'flex items-center gap-2' },
                h('span', { className: `text-[11px] px-2 py-0.5 rounded-full border ${c.open ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-slate-400 border-slate-500/30 bg-slate-500/10'}` }, c.open ? 'online' : 'offline'),
                h('button', {
                  onClick: () => onPingPeer(c.peerId),
                  className: 'text-[11px] px-2 py-1 rounded-md bg-slate-500/10 text-slate-400 hover:bg-slate-500/20'
                }, 'Ping'),
                h('button', {
                  onClick: () => onRequestSnapshot(c.peerId),
                  className: 'text-[11px] px-2 py-1 rounded-md bg-brand-500/10 text-brand-400 hover:bg-brand-500/20'
                }, 'Request Sync'),
                h('button', {
                  onClick: () => onDisconnectPeer(c.peerId),
                  className: 'text-[11px] px-2 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20'
                }, 'Disconnect')
              )
            )
          )
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

// ============ SETTINGS VIEW ============
function SettingsView({ identity, setIdentity, settings, setSettings, isDark, state, agents }) {
  const [editName, setEditName] = useState(identity?.displayName || '');
  const [editRole, setEditRole] = useState(identity?.role || 'L1');
  const bg = isDark ? 'bg-slate-800/50 border-slate-700/50' : 'bg-white border-slate-200';

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

  return h('div', { className: 'flex-1 overflow-y-auto p-6 space-y-6 max-w-2xl' },
    // Identity
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4 flex items-center gap-2' }, h(Icon, { name: 'key', size: 18 }), 'Cryptographic Identity'),
      h('div', { className: `p-4 rounded-lg mb-4 font-mono text-sm break-all ${isDark ? 'bg-slate-900 text-brand-400' : 'bg-slate-50 text-brand-600'}` },
        identity?.publicKeyFingerprint
      ),
      h('div', { className: `text-xs mb-4 ${isDark ? 'text-slate-500' : 'text-slate-400'}` }, 'Peer ID: ', h('span', { className: 'font-mono text-brand-400' }, identity?.peerId)),
      h('div', { className: 'space-y-3' },
        h('div', null,
          h('label', { className: 'text-sm text-slate-400 block mb-1' }, 'Display Name'),
          h('input', {
            type: 'text', value: editName, onChange: e => setEditName(e.target.value),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', null,
          h('label', { className: 'text-sm text-slate-400 block mb-1' }, 'Role'),
          h('select', {
            value: editRole, onChange: e => setEditRole(e.target.value),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          }, ROLES.map(r => h('option', { key: r, value: r }, r + ' Support')))
        ),
        h('button', { onClick: handleSave, className: 'px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm rounded-lg font-medium transition-colors' }, 'Save Changes')
      )
    ),

    // Theme
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4' }, 'Appearance'),
      h('div', { className: 'flex items-center justify-between' },
        h('span', { className: 'text-sm' }, 'Dark Mode'),
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
          h('div', { className: 'text-sm' }, 'Demo Mode'),
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
          h('div', { className: 'text-sm' }, 'Use Custom PeerJS Server'),
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
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Host'),
          h('input', {
            type: 'text',
            value: settings.peerServer?.host || '',
            onChange: e => setSettings(s => ({ ...s, peerServer: { ...s.peerServer, host: e.target.value } })),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', null,
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Port'),
          h('input', {
            type: 'number',
            value: settings.peerServer?.port ?? 9000,
            onChange: e => setSettings(s => ({ ...s, peerServer: { ...s.peerServer, port: Number(e.target.value) } })),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', null,
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Path'),
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
          h('span', { className: 'text-sm' }, 'Secure (wss)')
        )
      )
    ),

    // TURN
    h('div', { className: `rounded-xl border ${bg} p-6` },
      h('h3', { className: 'text-lg font-semibold mb-4' }, 'TURN Relay'),
      h('div', { className: 'flex items-center justify-between mb-4' },
        h('div', null,
          h('div', { className: 'text-sm' }, 'Enable TURN'),
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
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'TURN Host'),
          h('input', {
            type: 'text',
            value: settings.turn?.host || '',
            onChange: e => setSettings(s => ({ ...s, turn: { ...s.turn, host: e.target.value } })),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', null,
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'TURN Port'),
          h('input', {
            type: 'number',
            value: settings.turn?.port ?? 3478,
            onChange: e => setSettings(s => ({ ...s, turn: { ...s.turn, port: Number(e.target.value) } })),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', null,
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Username'),
          h('input', {
            type: 'text',
            value: settings.turn?.username || '',
            onChange: e => setSettings(s => ({ ...s, turn: { ...s.turn, username: e.target.value } })),
            className: `w-full px-3 py-2 text-sm rounded-lg border ${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'} focus:outline-none focus:border-brand-500`
          })
        ),
        h('div', null,
          h('label', { className: `text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} block mb-1` }, 'Credential'),
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
          h('span', { className: 'text-sm' }, 'Use TLS (turns)')
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
