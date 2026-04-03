const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
let WAClient, WALocalAuth;
try {
  const wwjs = require('whatsapp-web.js');
  WAClient = wwjs.Client;
  WALocalAuth = wwjs.LocalAuth;
} catch(e) {
  console.log('[WhatsApp] whatsapp-web.js non disponible (normal sur cloud sans Chromium)');
}
let QRCode;
try { QRCode = require('qrcode'); } catch(e) {}

const app = express();
const PORT = process.env.PORT || 3002;

// ============ WHATSAPP CLIENT ============
let waClient = null;
let waStatus = 'disconnected'; // disconnected, qr_pending, connected, error
let waQRCode = null; // base64 QR image
let waInfo = null; // connected phone info

function initWhatsApp() {
  if (!WAClient || !WALocalAuth) {
    waStatus = 'unavailable';
    console.log('[WhatsApp] Client non disponible - emails uniquement');
    return;
  }
  try {
    waClient = new WAClient({
      authStrategy: new WALocalAuth({ dataPath: path.join(__dirname, 'data', '.wwebjs_auth') }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run'],
      }
    });

    waClient.on('qr', async (qr) => {
      waStatus = 'qr_pending';
      if (QRCode) waQRCode = await QRCode.toDataURL(qr);
      console.log('[WhatsApp] QR Code généré - scannez-le depuis l\'interface');
    });

    waClient.on('ready', () => {
      waStatus = 'connected';
      waQRCode = null;
      waInfo = waClient.info;
      console.log(`[WhatsApp] Connecté ! Numéro: ${waClient.info.wid.user}`);
    });

    waClient.on('authenticated', () => {
      console.log('[WhatsApp] Authentifié avec succès');
    });

    waClient.on('auth_failure', (msg) => {
      waStatus = 'error';
      console.error('[WhatsApp] Erreur d\'authentification:', msg);
    });

    waClient.on('disconnected', (reason) => {
      waStatus = 'disconnected';
      waQRCode = null;
      waInfo = null;
      console.log('[WhatsApp] Déconnecté:', reason);
      // Auto-reconnect after 5s (only if not in cloud without Chromium)
      if (reason !== 'NAVIGATION') {
        setTimeout(() => {
          console.log('[WhatsApp] Tentative de reconnexion...');
          initWhatsApp();
        }, 5000);
      }
    });

    waClient.initialize().catch(err => {
      waStatus = 'unavailable';
      waClient = null;
      console.error('[WhatsApp] Erreur init (Chromium absent ?):', err.message);
    });
    console.log('[WhatsApp] Initialisation en cours...');
  } catch (e) {
    waStatus = 'unavailable';
    waClient = null;
    console.error('[WhatsApp] Erreur init:', e.message);
  }
}

// Start WhatsApp client
initWhatsApp();

async function sendWhatsApp(phone, message) {
  if (!waClient || waStatus !== 'connected') {
    throw new Error('WhatsApp non connecté. Scannez le QR code dans Automatisations.');
  }
  // Normalize phone: remove spaces, ensure country code
  let cleanPhone = phone.replace(/[\s\-\.]/g, '');
  if (cleanPhone.startsWith('0')) cleanPhone = '33' + cleanPhone.substring(1);
  if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1);
  // WhatsApp format: countrycode + number + @c.us
  const chatId = cleanPhone + '@c.us';

  // Check if number is registered on WhatsApp
  const isRegistered = await waClient.isRegisteredUser(chatId);
  if (!isRegistered) {
    throw new Error(`${phone} n'est pas sur WhatsApp`);
  }

  await waClient.sendMessage(chatId, message);
  return chatId;
}

app.use(express.json({ limit: '10mb' }));
// Only serve specific static assets, not the full public folder (to avoid conflicts with main server's index.html)
app.use('/parcoursup/assets/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/parcoursup/assets/images', express.static(path.join(__dirname, 'public', 'images')));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ============ PIN AUTH ============
const PARCOURSUP_PIN = process.env.PARCOURSUP_PIN || 'NSWILL26';
const activeSessions = new Map(); // token -> { createdAt }

app.post('/parcoursup/api/auth', (req, res) => {
  const { pin } = req.body;
  if (pin === PARCOURSUP_PIN) {
    const token = genId() + genId();
    activeSessions.set(token, { createdAt: new Date() });
    // Clean old sessions (>24h)
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const [t, s] of activeSessions) {
      if (new Date(s.createdAt).getTime() < dayAgo) activeSessions.delete(t);
    }
    return res.json({ success: true, token });
  }
  res.status(401).json({ success: false, error: 'Code PIN incorrect' });
});

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && activeSessions.has(token)) return next();
  res.status(401).json({ error: 'Non authentifié' });
}

// Apply auth to all API routes except /auth and /health
app.use('/parcoursup/api', (req, res, next) => {
  if (req.path === '/auth' || req.path === '/health' || req.path === '/events') return next();
  requireAuth(req, res, next);
});

// ============ SSE (Server-Sent Events) for real-time sync ============
const sseClients = new Set();

app.get('/parcoursup/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write('data: connected\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcast(event = 'update') {
  const msg = `data: ${event}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch(e) { sseClients.delete(client); }
  }
}

// JSON helpers
const DATA_DIR = path.join(__dirname, 'data');

function loadJSON(filename) {
  const filepath = path.join(DATA_DIR, filename);
  try {
    if (!fs.existsSync(filepath)) return filename.endsWith('config.json') ? {} : [];
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.error(`Error loading ${filename}:`, e.message);
    return filename.endsWith('config.json') ? {} : [];
  }
}

function saveJSON(filename, data) {
  const filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// ============ DEFAULT CONFIG (used when data file doesn't exist, e.g. fresh Render deploy) ============
const DEFAULT_PARCOURSUP_CONFIG = {
  ecoles: {
    "NOSCHOOL": { color: "#F1C40F", formations: { "BTS Assurance": { conseiller: null }, "BTS COMMUNICATION": { conseiller: "Alexandra" }, "BTS CG": { conseiller: "Thomas" }, "BTS GPME": { conseiller: "Annick" }, "BTS MCO": { conseiller: "Alexandra" }, "BTS NDRC": { conseiller: "Alexandra" }, "BTS PIM": { conseiller: "Arnaud" }, "BTS SAM": { conseiller: "Annick" }, "BTS TOURISME": { conseiller: "Annick" } } },
    "NOSCHOOL MDM": { color: "#E91E8C", formations: { "BTS COMMUNICATION": { conseiller: "Laurine" }, "BTS GPME": { conseiller: "Laurine" }, "BTS MCO": { conseiller: "Laurine" }, "BTS NDRC": { conseiller: "Laurine" } } },
    "WILL.SCHOOL": { color: "#002FA7", formations: { "BTS COMMUNICATION": { conseiller: "Maud" }, "BTS ESF": { conseiller: "Camille" }, "BTS GPME": { conseiller: "Camille" }, "BTS MCO": { conseiller: "Maud" }, "BTS NDRC": { conseiller: "Maud" }, "BTS SP3S": { conseiller: "Camille" } } }
  },
  chargesAdmission: ["Cécilia", "Lisa", "Léo", "Peyo", "Lynn", "Kilian", "Mathis", "Giulia"],
  stages: [
    { id: "voeu_recu", label: "Voeu reçu", color: "#9B59B6", order: 0 },
    { id: "relance_mail_n1", label: "Relance mail N°1", color: "#3498DB", order: 1 },
    { id: "contacte", label: "Contacté", color: "#3498DB", order: 2 },
    { id: "rdv_planifie", label: "RDV Planifié", color: "#F39C12", order: 3 },
    { id: "admis", label: "Admis", color: "#2ECC71", order: 4 },
    { id: "inscrit", label: "Inscrit", color: "#27AE60", order: 5 },
    { id: "refuse", label: "Refusé", color: "#E74C3C", order: 6 },
    { id: "abandonne", label: "Abandonné", color: "#95A5A6", order: 7 }
  ],
  relanceTypes: [
    { id: "telephone", label: "Téléphone", icon: "phone" },
    { id: "mail", label: "Mail", icon: "mail" },
    { id: "whatsapp", label: "WhatsApp", icon: "message-circle" },
    { id: "courrier", label: "Courrier", icon: "send" }
  ],
  relanceResults: [
    { id: "repondu", label: "Répondu" },
    { id: "no_answer", label: "Pas de réponse" },
    { id: "message_laisse", label: "Message laissé" },
    { id: "envoye", label: "Envoyé" },
    { id: "autre", label: "Autre" }
  ],
  automations: {
    voeu_recu: {
      enabled: true, id: "voeu_recu",
      actions: [
        { channel: "mail", subject: "", message: "Bonjour {{prenom}}\nParcoursup TEST\nLaurent ", delayMinutes: 6 },
        { channel: "whatsapp", subject: "", message: "Bonjour {{prenom}} {{nom}}\nWelcome Test via Parcoursup \nLaurent ", delayMinutes: 5 }
      ]
    },
    relance_mail_n1: {
      enabled: true, id: "relance_mail_n1",
      actions: [
        { channel: "mail", subject: "", message: "Bonjour{{prenom}} j'espère que tu vas bien ? \nTest auto à 10mn \nBienvenue dans chez {{ecole}} dans la {{formation}}\nWelcome", delayMinutes: 10 },
        { channel: "whatsapp", subject: "", message: "Bonjour{{prenom}} j'espère que tu vas bien ? peux tu me dire si tu as bien reçu ce Whatsapp la bistte ", delayMinutes: 5 }
      ]
    },
    contacte: {
      enabled: true, id: "contacte",
      actions: [
        { channel: "mail", subject: "bienvenue chez {{ecole}} ...appelle moi vite", message: "Bonjour {{prenom}}Appelle moi vite car je dois échanger avec toi sur ta formation en  {{formation}} chez {{ecole}}\nBelle journée Laurent ", delayMinutes: 3 },
        { channel: "whatsapp", subject: "", message: "Bonjour {{prenom}}Appelle moi vite car je dois échanger avec toi sur ta formation en  {{formation}} chez {{ecole}}\nBelle journée Laurent ", delayMinutes: 2 }
      ]
    }
  }
};

// ============ CONFIG ============
app.get('/parcoursup/api/config', (req, res) => {
  const cfg = loadJSON('parcoursup-config.json');
  // If config is empty or missing key sections (fresh deploy), merge with defaults
  if (!cfg.stages || !cfg.ecoles) {
    // Deep merge: keep user overrides, fill missing with defaults
    const merged = { ...DEFAULT_PARCOURSUP_CONFIG, ...cfg };
    // Ensure automations are preserved: if user has none, use defaults
    if (!cfg.automations || Object.keys(cfg.automations).length === 0) {
      merged.automations = DEFAULT_PARCOURSUP_CONFIG.automations;
    }
    saveJSON('parcoursup-config.json', merged);
    return res.json(merged);
  }
  res.json(cfg);
});

app.post('/parcoursup/api/config', (req, res) => {
  saveJSON('parcoursup-config.json', req.body);
  res.json({ success: true });
});

// ============ CANDIDATES ============
app.get('/parcoursup/api/candidates', (req, res) => {
  let candidates = loadJSON('parcoursup-candidates.json');
  const { ecole, formation, stage, charge, conseiller, search } = req.query;
  if (ecole) candidates = candidates.filter(c => c.ecole === ecole);
  if (formation) candidates = candidates.filter(c => c.formation === formation);
  if (stage) candidates = candidates.filter(c => c.stage === stage);
  if (charge) candidates = candidates.filter(c => c.chargeAdmission === charge);
  if (conseiller) candidates = candidates.filter(c => c.conseillerFormation === conseiller);
  if (search) {
    const s = search.toLowerCase();
    candidates = candidates.filter(c =>
      (c.nom || '').toLowerCase().includes(s) ||
      (c.prenom || '').toLowerCase().includes(s) ||
      (c.email || '').toLowerCase().includes(s) ||
      (c.telephone || '').includes(s)
    );
  }
  res.json(candidates);
});

app.post('/parcoursup/api/candidates', (req, res) => {
  const candidates = loadJSON('parcoursup-candidates.json');
  const now = new Date().toISOString();
  const candidate = {
    id: genId(),
    nom: req.body.nom || '',
    prenom: req.body.prenom || '',
    telephone: req.body.telephone || '',
    email: req.body.email || '',
    ecole: req.body.ecole || '',
    formation: req.body.formation || '',
    conseillerFormation: req.body.conseillerFormation || '',
    chargeAdmission: req.body.chargeAdmission || '',
    stage: req.body.stage || 'voeu_recu',
    statutCRM: req.body.statutCRM || false,
    notes: req.body.notes || '',
    rating: req.body.rating || 0,
    createdAt: now,
    updatedAt: now
  };
  candidates.push(candidate);
  saveJSON('parcoursup-candidates.json', candidates);
  broadcast('candidates');
  res.json(candidate);
});

app.put('/parcoursup/api/candidates/:id', (req, res) => {
  const candidates = loadJSON('parcoursup-candidates.json');
  const idx = candidates.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Candidat non trouvé' });
  candidates[idx] = { ...candidates[idx], ...req.body, updatedAt: new Date().toISOString() };
  saveJSON('parcoursup-candidates.json', candidates);
  broadcast('candidates');
  res.json(candidates[idx]);
});

app.patch('/parcoursup/api/candidates/:id/stage', (req, res) => {
  const candidates = loadJSON('parcoursup-candidates.json');
  const idx = candidates.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Candidat non trouvé' });
  const oldStage = candidates[idx].stage;
  const newStage = req.body.stage;
  candidates[idx].stage = newStage;
  candidates[idx].updatedAt = new Date().toISOString();
  saveJSON('parcoursup-candidates.json', candidates);

  // Trigger automations if stage changed
  if (oldStage !== newStage) {
    triggerAutomation(candidates[idx].id, newStage);
  }

  broadcast('candidates');
  res.json(candidates[idx]);
});

// Helper to trigger automation inline
function triggerAutomation(candidateId, stageId) {
  try {
    const config = loadJSON('parcoursup-config.json');
    const candidates = loadJSON('parcoursup-candidates.json');
    const queue = loadJSON('parcoursup-queue.json');
    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate) return;

    const automations = config.automations || {};
    const stageAutos = automations[stageId];
    if (!stageAutos || !stageAutos.enabled) return;

    const stageInfo = (config.stages || []).find(s => s.id === stageId);
    const now = new Date();

    // Avoid duplicates: only block if same candidate+stage automation is pending or was sent in the last 10 minutes
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const alreadyQueued = queue.some(q =>
      q.candidateId === candidateId && q.stageId === stageId && q.automationId &&
      (q.status === 'pending' || (q.status === 'sent' && q.createdAt > tenMinAgo))
    );
    if (alreadyQueued) return;

    (stageAutos.actions || []).forEach(action => {
      const delayMs = (action.delayMinutes || 0) * 60 * 1000;
      const scheduledAt = new Date(now.getTime() + delayMs);

      let message = (action.message || '')
        .replace(/\{\{prenom\}\}/g, candidate.prenom || '').replace(/\{\{nom\}\}/g, candidate.nom || '')
        .replace(/\{\{formation\}\}/g, candidate.formation || '').replace(/\{\{ecole\}\}/g, candidate.ecole || '')
        .replace(/\{\{email\}\}/g, candidate.email || '').replace(/\{\{telephone\}\}/g, candidate.telephone || '');
      let subject = (action.subject || '')
        .replace(/\{\{prenom\}\}/g, candidate.prenom || '').replace(/\{\{nom\}\}/g, candidate.nom || '')
        .replace(/\{\{formation\}\}/g, candidate.formation || '').replace(/\{\{ecole\}\}/g, candidate.ecole || '');

      queue.push({
        id: genId(), candidateId: candidate.id,
        candidateName: `${candidate.prenom} ${candidate.nom}`,
        candidateEmail: candidate.email || '', candidatePhone: candidate.telephone || '',
        channel: action.channel || 'mail', subject, message, stageId,
        imageUrl: action.imageUrl || '',
        stageLabel: stageInfo?.label || stageId,
        scheduledAt: scheduledAt.toISOString(), status: 'pending',
        createdAt: now.toISOString(), sentAt: null, error: null,
        automationId: stageAutos.id || stageId
      });
    });

    saveJSON('parcoursup-queue.json', queue);
    console.log(`[Auto] Automation triggered for ${candidate.prenom} ${candidate.nom} -> ${stageId}`);
  } catch (e) {
    console.error('[Auto] Error triggering automation:', e.message);
  }
}

app.delete('/parcoursup/api/candidates/:id', (req, res) => {
  let candidates = loadJSON('parcoursup-candidates.json');
  candidates = candidates.filter(c => c.id !== req.params.id);
  saveJSON('parcoursup-candidates.json', candidates);
  // Also remove relances
  let relances = loadJSON('parcoursup-relances.json');
  relances = relances.filter(r => r.candidateId !== req.params.id);
  saveJSON('parcoursup-relances.json', relances);
  broadcast('candidates');
  res.json({ success: true });
});

// Bulk import
app.post('/parcoursup/api/candidates/bulk', (req, res) => {
  const existing = loadJSON('parcoursup-candidates.json');
  const now = new Date().toISOString();
  const newCandidates = (req.body.candidates || []).map(c => ({
    id: genId(),
    nom: c.nom || '',
    prenom: c.prenom || '',
    telephone: c.telephone || '',
    email: c.email || '',
    ecole: c.ecole || '',
    formation: c.formation || '',
    conseillerFormation: c.conseillerFormation || '',
    chargeAdmission: c.chargeAdmission || '',
    stage: c.stage || 'voeu_recu',
    statutCRM: c.statutCRM || false,
    notes: c.notes || '',
    createdAt: now,
    updatedAt: now
  }));
  const all = [...existing, ...newCandidates];
  saveJSON('parcoursup-candidates.json', all);
  broadcast('candidates');
  res.json({ imported: newCandidates.length, total: all.length });
});

// ============ RELANCES ============
app.get('/parcoursup/api/relances', (req, res) => {
  let relances = loadJSON('parcoursup-relances.json');
  if (req.query.candidateId) {
    relances = relances.filter(r => r.candidateId === req.query.candidateId);
  }
  res.json(relances);
});

app.post('/parcoursup/api/relances', (req, res) => {
  const relances = loadJSON('parcoursup-relances.json');
  const relance = {
    id: genId(),
    candidateId: req.body.candidateId,
    type: req.body.type || 'telephone',
    date: req.body.date || new Date().toISOString(),
    notes: req.body.notes || '',
    result: req.body.result || 'autre',
    createdBy: req.body.createdBy || ''
  };
  relances.push(relance);
  saveJSON('parcoursup-relances.json', relances);
  broadcast('relances');
  res.json(relance);
});

app.delete('/parcoursup/api/relances/:id', (req, res) => {
  let relances = loadJSON('parcoursup-relances.json');
  relances = relances.filter(r => r.id !== req.params.id);
  saveJSON('parcoursup-relances.json', relances);
  res.json({ success: true });
});

// ============ DUPLICATES ============
function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '').replace(/^33/, '0');
}

function normalizeEmail(email) {
  return (email || '').toLowerCase().trim();
}

function normalizeName(nom, prenom) {
  return ((nom || '') + (prenom || '')).toLowerCase().replace(/\s+/g, '').trim();
}

app.get('/parcoursup/api/duplicates', (req, res) => {
  const candidates = loadJSON('parcoursup-candidates.json');
  const groups = [];
  const visited = new Set();

  for (let i = 0; i < candidates.length; i++) {
    if (visited.has(i)) continue;
    const group = [candidates[i]];
    visited.add(i);

    for (let j = i + 1; j < candidates.length; j++) {
      if (visited.has(j)) continue;
      let matches = 0;
      const a = candidates[i], b = candidates[j];

      if (normalizeEmail(a.email) && normalizeEmail(a.email) === normalizeEmail(b.email)) matches++;
      if (normalizePhone(a.telephone) && normalizePhone(a.telephone) === normalizePhone(b.telephone)) matches++;
      if (normalizeName(a.nom, a.prenom) && normalizeName(a.nom, a.prenom) === normalizeName(b.nom, b.prenom)) matches++;

      if (matches >= 2) {
        group.push(candidates[j]);
        visited.add(j);
      }
    }
    if (group.length > 1) groups.push(group);
  }
  res.json({ groups, total: groups.length });
});

app.post('/parcoursup/api/duplicates/merge', (req, res) => {
  const { keepId, removeIds } = req.body;
  let candidates = loadJSON('parcoursup-candidates.json');
  let relances = loadJSON('parcoursup-relances.json');

  // Transfer relances to kept candidate
  relances = relances.map(r =>
    removeIds.includes(r.candidateId) ? { ...r, candidateId: keepId } : r
  );

  // Remove duplicate candidates
  candidates = candidates.filter(c => !removeIds.includes(c.id));

  saveJSON('parcoursup-candidates.json', candidates);
  saveJSON('parcoursup-relances.json', relances);
  broadcast('candidates');
  res.json({ success: true, remaining: candidates.length });
});

// ============ STATS ============
app.get('/parcoursup/api/stats', (req, res) => {
  const allCandidates = loadJSON('parcoursup-candidates.json');
  const allRelances = loadJSON('parcoursup-relances.json');
  const ecoleFilter = req.query.ecole || null;
  const candidates = ecoleFilter ? allCandidates.filter(c => c.ecole === ecoleFilter) : allCandidates;
  const candidateIds = new Set(candidates.map(c => c.id));
  const relances = ecoleFilter ? allRelances.filter(r => candidateIds.has(r.candidateId)) : allRelances;

  // Par ecole (toujours toutes les ecoles pour le filtre)
  const parEcole = {};
  allCandidates.forEach(c => {
    parEcole[c.ecole] = (parEcole[c.ecole] || 0) + 1;
  });

  // Par stage
  const parStage = {};
  candidates.forEach(c => {
    parStage[c.stage] = (parStage[c.stage] || 0) + 1;
  });

  // Par formation
  const parFormation = {};
  candidates.forEach(c => {
    const key = `${c.ecole} - ${c.formation}`;
    parFormation[key] = (parFormation[key] || 0) + 1;
  });

  // Conversion
  const total = candidates.length;
  const inscrits = candidates.filter(c => c.stage === 'inscrit').length;
  const admis = candidates.filter(c => c.stage === 'admis').length;

  // Relances par type
  const relancesParType = {};
  relances.forEach(r => {
    relancesParType[r.type] = (relancesParType[r.type] || 0) + 1;
  });

  // Par charge admission
  const parCharge = {};
  candidates.forEach(c => {
    if (!c.chargeAdmission) return;
    if (!parCharge[c.chargeAdmission]) {
      parCharge[c.chargeAdmission] = { total: 0, inscrits: 0, contactes: 0 };
    }
    parCharge[c.chargeAdmission].total++;
    if (c.stage === 'inscrit') parCharge[c.chargeAdmission].inscrits++;
    if (c.stage !== 'voeu_recu') parCharge[c.chargeAdmission].contactes++;
  });

  // Relances par jour (30 derniers jours)
  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const relancesParJour = {};
  relances.forEach(r => {
    const d = new Date(r.date);
    if (d >= thirtyDaysAgo) {
      const key = d.toISOString().split('T')[0];
      relancesParJour[key] = (relancesParJour[key] || 0) + 1;
    }
  });

  // Doublons
  let doublons = 0;
  const visited = new Set();
  for (let i = 0; i < candidates.length; i++) {
    if (visited.has(i)) continue;
    let hasDouble = false;
    for (let j = i + 1; j < candidates.length; j++) {
      if (visited.has(j)) continue;
      let matches = 0;
      const a = candidates[i], b = candidates[j];
      if (normalizeEmail(a.email) && normalizeEmail(a.email) === normalizeEmail(b.email)) matches++;
      if (normalizePhone(a.telephone) && normalizePhone(a.telephone) === normalizePhone(b.telephone)) matches++;
      if (normalizeName(a.nom, a.prenom) && normalizeName(a.nom, a.prenom) === normalizeName(b.nom, b.prenom)) matches++;
      if (matches >= 2) {
        visited.add(j);
        hasDouble = true;
      }
    }
    if (hasDouble) doublons++;
  }

  // Par ecole et stage (pour graphiques croises)
  const parEcoleStage = {};
  candidates.forEach(c => {
    if (!parEcoleStage[c.ecole]) parEcoleStage[c.ecole] = {};
    parEcoleStage[c.ecole][c.stage] = (parEcoleStage[c.ecole][c.stage] || 0) + 1;
  });

  // ===== STATS DÉTAILLÉES PAR CHARGÉ D'ADMISSION =====
  const config = loadJSON('parcoursup-config.json');
  const stages = config.stages || [];

  // Périodes : aujourd'hui, cette semaine (lundi), ce mois
  const todayStr = now.toISOString().split('T')[0];
  const dayOfWeek = now.getDay(); // 0=dim, 1=lun...
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - mondayOffset);
  weekStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Actions détaillées par chargé d'admission
  const chargeDetails = {};
  const allCharges = [...new Set(candidates.map(c => c.chargeAdmission).filter(Boolean))];

  allCharges.forEach(charge => {
    const myCandidates = candidates.filter(c => c.chargeAdmission === charge);
    const myRelances = relances.filter(r => myCandidates.some(c => c.id === r.candidateId));
    const myCandidateIds = new Set(myCandidates.map(c => c.id));

    // Actions par période
    const relancesToday = myRelances.filter(r => r.date && r.date.startsWith(todayStr));
    const relancesWeek = myRelances.filter(r => r.date && new Date(r.date) >= weekStart);
    const relancesMonth = myRelances.filter(r => r.date && new Date(r.date) >= monthStart);

    // Actions par type
    const actionsByType = {};
    myRelances.forEach(r => {
      actionsByType[r.type] = (actionsByType[r.type] || 0) + 1;
    });

    // Pipeline (combien dans chaque colonne)
    const pipeline = {};
    stages.forEach(s => {
      pipeline[s.id] = myCandidates.filter(c => c.stage === s.id).length;
    });

    // Taux de transformation CRM
    const crmCount = myCandidates.filter(c => c.statutCRM).length;
    const tauxCRM = myCandidates.length > 0 ? Math.round((crmCount / myCandidates.length) * 100) : 0;

    // Taux d'inscrits
    const inscritCount = myCandidates.filter(c => c.stage === 'inscrit').length;
    const tauxInscrit = myCandidates.length > 0 ? Math.round((inscritCount / myCandidates.length) * 100) : 0;

    // Temps moyen par stage (basé sur relances: temps entre création candidat et première relance)
    const tempsTraitement = {};
    stages.forEach(s => {
      const stageCandidates = myCandidates.filter(c => c.stage === s.id);
      if (stageCandidates.length === 0) return;
      let totalHours = 0;
      let counted = 0;
      stageCandidates.forEach(c => {
        const cRelances = myRelances.filter(r => r.candidateId === c.id);
        if (cRelances.length > 0 && c.createdAt) {
          const firstRelance = cRelances.sort((a, b) => new Date(a.date) - new Date(b.date))[0];
          const diffMs = new Date(firstRelance.date) - new Date(c.createdAt);
          totalHours += diffMs / (1000 * 60 * 60);
          counted++;
        }
      });
      if (counted > 0) {
        tempsTraitement[s.id] = Math.round((totalHours / counted) * 10) / 10;
      }
    });

    // Relances par jour (7 derniers jours) pour sparkline
    const last7Days = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      last7Days[key] = 0;
    }
    myRelances.forEach(r => {
      if (r.date) {
        const key = r.date.substring(0, 10);
        if (key in last7Days) last7Days[key]++;
      }
    });

    // Candidats sans aucune relance (à traiter)
    const sansRelance = myCandidates.filter(c => !myRelances.some(r => r.candidateId === c.id)).length;

    chargeDetails[charge] = {
      totalCandidats: myCandidates.length,
      relancesTotal: myRelances.length,
      relancesToday: relancesToday.length,
      relancesWeek: relancesWeek.length,
      relancesMonth: relancesMonth.length,
      actionsByType,
      pipeline,
      crmCount,
      tauxCRM,
      inscritCount,
      tauxInscrit,
      tempsTraitement,
      last7Days,
      sansRelance
    };
  });

  // Classement global: actions cette semaine
  const classementSemaine = allCharges
    .map(charge => ({ charge, actions: chargeDetails[charge].relancesWeek }))
    .sort((a, b) => b.actions - a.actions);

  // Taux basculement CRM global
  const totalCRM = candidates.filter(c => c.statutCRM).length;
  const tauxCRMGlobal = total > 0 ? Math.round((totalCRM / total) * 100) : 0;

  // Temps moyen global par stage
  const tempsGlobalParStage = {};
  stages.forEach(s => {
    const stageCandidates = candidates.filter(c => c.stage === s.id);
    if (stageCandidates.length === 0) return;
    let totalH = 0, cnt = 0;
    stageCandidates.forEach(c => {
      const cRel = relances.filter(r => r.candidateId === c.id);
      if (cRel.length > 0 && c.createdAt) {
        const first = cRel.sort((a, b) => new Date(a.date) - new Date(b.date))[0];
        const diff = new Date(first.date) - new Date(c.createdAt);
        totalH += diff / (1000 * 60 * 60);
        cnt++;
      }
    });
    if (cnt > 0) tempsGlobalParStage[s.id] = Math.round((totalH / cnt) * 10) / 10;
  });

  res.json({
    total,
    inscrits,
    admis,
    conversion: total > 0 ? Math.round((inscrits / total) * 100) : 0,
    parEcole,
    parStage,
    parFormation,
    relancesTotal: relances.length,
    relancesParType,
    parCharge,
    relancesParJour,
    doublons,
    parEcoleStage,
    // Nouvelles stats
    chargeDetails,
    classementSemaine,
    totalCRM,
    tauxCRMGlobal,
    tempsGlobalParStage
  });
});

// ============ AUTOMATIONS ============

// Get automations
app.get('/parcoursup/api/automations', (req, res) => {
  const config = loadJSON('parcoursup-config.json');
  res.json(config.automations || {});
});

// Save automations (keyed by stageId)
app.post('/parcoursup/api/automations', (req, res) => {
  const config = loadJSON('parcoursup-config.json');
  config.automations = req.body;
  saveJSON('parcoursup-config.json', config);
  res.json({ success: true });
});

// ============ SEND QUEUE ============

// Get queue
app.get('/parcoursup/api/queue', (req, res) => {
  const queue = loadJSON('parcoursup-queue.json');
  res.json(queue);
});

// Add to queue (manual bulk send or automation trigger)
app.post('/parcoursup/api/queue', (req, res) => {
  const queue = loadJSON('parcoursup-queue.json');
  const items = req.body.items || [];
  const now = new Date();
  items.forEach(item => {
    queue.push({
      id: genId(),
      candidateId: item.candidateId,
      candidateName: item.candidateName || '',
      candidateEmail: item.candidateEmail || '',
      candidatePhone: item.candidatePhone || '',
      channel: item.channel || 'mail', // mail, whatsapp
      subject: item.subject || '',
      message: item.message || '',
      imageUrl: item.imageUrl || '',
      stageId: item.stageId || '',
      stageLabel: item.stageLabel || '',
      scheduledAt: item.scheduledAt || now.toISOString(),
      status: 'pending', // pending, sent, failed
      createdAt: now.toISOString(),
      sentAt: null,
      error: null,
      automationId: item.automationId || null
    });
  });
  saveJSON('parcoursup-queue.json', queue);
  res.json({ queued: items.length, total: queue.length });
});

// Cancel a queued item
app.delete('/parcoursup/api/queue/:id', (req, res) => {
  let queue = loadJSON('parcoursup-queue.json');
  queue = queue.filter(q => q.id !== req.params.id);
  saveJSON('parcoursup-queue.json', queue);
  res.json({ success: true });
});

// Process queue - uses the shared processQueue function
app.post('/parcoursup/api/queue/process', async (req, res) => {
  await processQueue();
  res.json({ ok: true });
});

// Trigger automation for a candidate entering a stage
app.post('/parcoursup/api/automations/trigger', (req, res) => {
  const { candidateId, stageId } = req.body;
  const config = loadJSON('parcoursup-config.json');
  const candidates = loadJSON('parcoursup-candidates.json');
  const queue = loadJSON('parcoursup-queue.json');

  const candidate = candidates.find(c => c.id === candidateId);
  if (!candidate) return res.status(404).json({ error: 'Candidat non trouvé' });

  const automations = config.automations || {};
  const stageAutos = automations[stageId];
  if (!stageAutos || !stageAutos.enabled) return res.json({ triggered: 0 });

  const stageInfo = (config.stages || []).find(s => s.id === stageId);
  const now = new Date();
  let triggered = 0;

  // Check if automation already triggered for this candidate+stage (avoid duplicates)
  const alreadyQueued = queue.some(q =>
    q.candidateId === candidateId &&
    q.stageId === stageId &&
    q.automationId &&
    (q.status === 'pending' || q.status === 'sent')
  );
  if (alreadyQueued) return res.json({ triggered: 0, reason: 'already_queued' });

  (stageAutos.actions || []).forEach(action => {
    const delayMs = (action.delayMinutes || 0) * 60 * 1000;
    const scheduledAt = new Date(now.getTime() + delayMs);

    // Replace template variables
    let message = (action.message || '')
      .replace(/\{\{prenom\}\}/g, candidate.prenom || '')
      .replace(/\{\{nom\}\}/g, candidate.nom || '')
      .replace(/\{\{formation\}\}/g, candidate.formation || '')
      .replace(/\{\{ecole\}\}/g, candidate.ecole || '')
      .replace(/\{\{email\}\}/g, candidate.email || '')
      .replace(/\{\{telephone\}\}/g, candidate.telephone || '');

    let subject = (action.subject || '')
      .replace(/\{\{prenom\}\}/g, candidate.prenom || '')
      .replace(/\{\{nom\}\}/g, candidate.nom || '')
      .replace(/\{\{formation\}\}/g, candidate.formation || '')
      .replace(/\{\{ecole\}\}/g, candidate.ecole || '');

    queue.push({
      id: genId(),
      candidateId: candidate.id,
      candidateName: `${candidate.prenom} ${candidate.nom}`,
      candidateEmail: candidate.email || '',
      candidatePhone: candidate.telephone || '',
      channel: action.channel || 'mail',
      subject,
      message,
      imageUrl: action.imageUrl || '',
      stageId,
      stageLabel: stageInfo?.label || stageId,
      scheduledAt: scheduledAt.toISOString(),
      status: 'pending',
      createdAt: now.toISOString(),
      sentAt: null,
      error: null,
      automationId: stageAutos.id || stageId
    });
    triggered++;
  });

  saveJSON('parcoursup-queue.json', queue);
  res.json({ triggered });
});

// Trigger automation for ALL candidates currently in a stage (retroactive)
app.post('/parcoursup/api/automations/trigger-all', (req, res) => {
  const { stageId } = req.body;
  const config = loadJSON('parcoursup-config.json');
  const candidates = loadJSON('parcoursup-candidates.json');
  const queue = loadJSON('parcoursup-queue.json');

  const automations = config.automations || {};
  const stageAutos = automations[stageId];
  if (!stageAutos || !stageAutos.enabled) {
    return res.json({ triggered: 0, reason: 'automation_disabled' });
  }

  const stageCandidates = candidates.filter(c => c.stage === stageId);
  const stageInfo = (config.stages || []).find(s => s.id === stageId);
  const now = new Date();
  let totalTriggered = 0;

  stageCandidates.forEach(candidate => {
    // Check if automation already triggered for this candidate+stage
    const alreadyQueued = queue.some(q =>
      q.candidateId === candidate.id &&
      q.stageId === stageId &&
      q.automationId &&
      (q.status === 'pending' || q.status === 'sent')
    );
    if (alreadyQueued) return;

    (stageAutos.actions || []).forEach(action => {
      const delayMs = (action.delayMinutes || 0) * 60 * 1000;
      const scheduledAt = new Date(now.getTime() + delayMs);

      let message = (action.message || '')
        .replace(/\{\{prenom\}\}/g, candidate.prenom || '').replace(/\{\{nom\}\}/g, candidate.nom || '')
        .replace(/\{\{formation\}\}/g, candidate.formation || '').replace(/\{\{ecole\}\}/g, candidate.ecole || '')
        .replace(/\{\{email\}\}/g, candidate.email || '').replace(/\{\{telephone\}\}/g, candidate.telephone || '');

      let subject = (action.subject || '')
        .replace(/\{\{prenom\}\}/g, candidate.prenom || '').replace(/\{\{nom\}\}/g, candidate.nom || '')
        .replace(/\{\{formation\}\}/g, candidate.formation || '').replace(/\{\{ecole\}\}/g, candidate.ecole || '');

      queue.push({
        id: genId(), candidateId: candidate.id,
        candidateName: `${candidate.prenom} ${candidate.nom}`,
        candidateEmail: candidate.email || '', candidatePhone: candidate.telephone || '',
        channel: action.channel || 'mail', subject, message, stageId,
        imageUrl: action.imageUrl || '',
        stageLabel: stageInfo?.label || stageId,
        scheduledAt: scheduledAt.toISOString(), status: 'pending',
        createdAt: now.toISOString(), sentAt: null, error: null,
        automationId: stageAutos.id || stageId
      });
      totalTriggered++;
    });
  });

  saveJSON('parcoursup-queue.json', queue);
  console.log(`[Auto] Retroactive trigger: ${totalTriggered} action(s) for ${stageCandidates.length} candidate(s) in ${stageId}`);
  res.json({ triggered: totalTriggered, candidates: stageCandidates.length });
});

// Bulk send to all candidates in a stage
app.post('/parcoursup/api/queue/bulk-send', (req, res) => {
  const { stageId, channel, subject, message, delayMinutes, imageUrl } = req.body;
  const candidates = loadJSON('parcoursup-candidates.json');
  const config = loadJSON('parcoursup-config.json');
  const queue = loadJSON('parcoursup-queue.json');

  const stageCandidates = candidates.filter(c => c.stage === stageId);
  const stageInfo = (config.stages || []).find(s => s.id === stageId);
  const now = new Date();
  const delayMs = (delayMinutes || 0) * 60 * 1000;
  const scheduledAt = new Date(now.getTime() + delayMs);

  stageCandidates.forEach(candidate => {
    let msg = (message || '')
      .replace(/\{\{prenom\}\}/g, candidate.prenom || '')
      .replace(/\{\{nom\}\}/g, candidate.nom || '')
      .replace(/\{\{formation\}\}/g, candidate.formation || '')
      .replace(/\{\{ecole\}\}/g, candidate.ecole || '')
      .replace(/\{\{email\}\}/g, candidate.email || '')
      .replace(/\{\{telephone\}\}/g, candidate.telephone || '');

    let subj = (subject || '')
      .replace(/\{\{prenom\}\}/g, candidate.prenom || '')
      .replace(/\{\{nom\}\}/g, candidate.nom || '')
      .replace(/\{\{formation\}\}/g, candidate.formation || '')
      .replace(/\{\{ecole\}\}/g, candidate.ecole || '');

    queue.push({
      id: genId(),
      candidateId: candidate.id,
      candidateName: `${candidate.prenom} ${candidate.nom}`,
      candidateEmail: candidate.email || '',
      candidatePhone: candidate.telephone || '',
      channel: channel || 'mail',
      subject: subj,
      message: msg,
      imageUrl: imageUrl || '',
      stageId,
      stageLabel: stageInfo?.label || stageId,
      scheduledAt: scheduledAt.toISOString(),
      status: 'pending',
      createdAt: now.toISOString(),
      sentAt: null,
      error: null,
      automationId: null
    });
  });

  saveJSON('parcoursup-queue.json', queue);
  res.json({ queued: stageCandidates.length });
});

// ============ SMTP CONFIG ============

function getSmtpConfig() {
  // 1. Check env vars (for cloud deployment like Render)
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      fromName: process.env.SMTP_FROM_NAME || 'Service Admissions'
    };
  }
  // 2. Check parcoursup config file
  const pConfig = loadJSON('parcoursup-config.json');
  if (pConfig.smtp && pConfig.smtp.host && pConfig.smtp.user && pConfig.smtp.pass) {
    return pConfig.smtp;
  }
  // 3. Fallback to admission config (shared between CRMs)
  const aConfig = loadJSON('admission-config.json');
  if (aConfig.smtp && aConfig.smtp.host) return aConfig.smtp;
  return null;
}

app.get('/parcoursup/api/smtp-config', (req, res) => {
  const smtp = getSmtpConfig();
  if (!smtp) return res.json({ configured: false, host: '', port: 587, user: '', fromName: 'CRM Parcoursup' });
  res.json({
    host: smtp.host || '',
    port: smtp.port || 587,
    user: smtp.user ? smtp.user.substring(0, 5) + '***' : '',
    fromName: smtp.fromName || 'CRM Parcoursup',
    configured: !!(smtp.host && smtp.user && smtp.pass),
  });
});

app.post('/parcoursup/api/smtp-config', (req, res) => {
  const config = loadJSON('parcoursup-config.json');
  const { host, port, user, pass, fromName } = req.body;
  config.smtp = { host, port: parseInt(port) || 587, user, pass, fromName: fromName || 'CRM Parcoursup' };
  saveJSON('parcoursup-config.json', config);
  res.json({ ok: true, message: 'Configuration SMTP sauvegardée' });
});

app.post('/parcoursup/api/smtp-test', async (req, res) => {
  const smtp = getSmtpConfig();
  if (!smtp || !smtp.host) return res.json({ ok: false, error: 'SMTP non configuré' });
  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host, port: smtp.port || 587, secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    await transporter.verify();
    res.json({ ok: true, message: 'Connexion SMTP réussie !' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/parcoursup/api/send-email', async (req, res) => {
  const smtp = getSmtpConfig();
  if (!smtp || !smtp.host) return res.status(400).json({ error: 'SMTP non configuré' });
  const { to, subject, body, imageUrl } = req.body;
  if (!to || !subject || !body) return res.status(400).json({ error: 'Champs requis: to, subject, body' });
  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host, port: smtp.port || 587, secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    let htmlBody = body.replace(/\n/g, '<br>');
    if (imageUrl) {
      htmlBody += `<br><br><img src="${imageUrl}" alt="" style="max-width:100%;height:auto;border-radius:8px;" />`;
    }
    const info = await transporter.sendMail({
      from: `"${smtp.fromName || 'CRM Parcoursup'}" <${smtp.user}>`,
      to, subject,
      html: htmlBody,
    });
    res.json({ ok: true, messageId: info.messageId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ WHATSAPP API ============

app.get('/parcoursup/api/whatsapp/status', (req, res) => {
  res.json({
    status: waStatus,
    qrCode: waQRCode,
    phone: waInfo ? waInfo.wid.user : null,
    name: waInfo ? waInfo.pushname : null,
  });
});

app.post('/parcoursup/api/whatsapp/reconnect', (req, res) => {
  if (waClient) {
    try { waClient.destroy(); } catch(e) {}
  }
  waStatus = 'disconnected';
  waQRCode = null;
  waInfo = null;
  setTimeout(initWhatsApp, 1000);
  res.json({ ok: true, message: 'Reconnexion lancée...' });
});

app.post('/parcoursup/api/whatsapp/logout', async (req, res) => {
  try {
    if (waClient) await waClient.logout();
    waStatus = 'disconnected';
    waQRCode = null;
    waInfo = null;
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

// ============ QUEUE PROCESSOR (auto-run every 30s) ============

async function sendEmail(to, subject, body, imageUrl) {
  const smtp = getSmtpConfig();
  if (!smtp || !smtp.host) throw new Error('SMTP non configuré');
  const transporter = nodemailer.createTransport({
    host: smtp.host, port: smtp.port || 587, secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  let htmlBody = body.replace(/\n/g, '<br>');
  if (imageUrl) {
    htmlBody += `<br><br><img src="${imageUrl}" alt="" style="max-width:100%;height:auto;border-radius:8px;" />`;
  }
  const info = await transporter.sendMail({
    from: `"${smtp.fromName || 'CRM Parcoursup'}" <${smtp.user}>`,
    to, subject: subject || '(sans objet)',
    html: htmlBody,
  });
  return info.messageId;
}

async function processQueue() {
  const queue = loadJSON('parcoursup-queue.json');
  const relances = loadJSON('parcoursup-relances.json');
  const now = new Date();
  let processed = 0;
  let errors = 0;

  for (const item of queue) {
    if (item.status !== 'pending') continue;
    const scheduledTime = new Date(item.scheduledAt);
    if (scheduledTime > now) continue;

    // Attempt real send for email channel
    if (item.channel === 'mail' && item.candidateEmail) {
      try {
        const messageId = await sendEmail(item.candidateEmail, item.subject, item.message, item.imageUrl);
        item.status = 'sent';
        item.sentAt = now.toISOString();
        item.messageId = messageId;
        console.log(`[Queue] Email envoyé à ${item.candidateEmail} (${messageId})`);
      } catch (e) {
        item.status = 'failed';
        item.error = e.message;
        item.sentAt = now.toISOString();
        errors++;
        console.error(`[Queue] Erreur email ${item.candidateEmail}: ${e.message}`);
      }
    } else if (item.channel === 'whatsapp' && item.candidatePhone) {
      try {
        const chatId = await sendWhatsApp(item.candidatePhone, item.message);
        item.status = 'sent';
        item.sentAt = now.toISOString();
        console.log(`[Queue] WhatsApp envoyé à ${item.candidatePhone} (${chatId})`);
      } catch (e) {
        item.status = 'failed';
        item.error = e.message;
        item.sentAt = now.toISOString();
        errors++;
        console.error(`[Queue] Erreur WhatsApp ${item.candidatePhone}: ${e.message}`);
      }
    } else {
      item.status = 'sent';
      item.sentAt = now.toISOString();
    }

    processed++;

    // Auto-log relance
    relances.push({
      id: genId(),
      candidateId: item.candidateId,
      type: item.channel,
      date: now.toISOString(),
      notes: `[AUTO${item.status === 'failed' ? ' ÉCHEC' : ''}] ${item.stageLabel ? item.stageLabel + ' | ' : ''}${item.subject ? item.subject + ' | ' : ''}${item.message.substring(0, 120)}`,
      result: item.status === 'failed' ? 'echoue' : 'envoye',
      createdBy: 'Automatisation'
    });
  }

  if (processed > 0) {
    saveJSON('parcoursup-queue.json', queue);
    saveJSON('parcoursup-relances.json', relances);
    console.log(`[Queue] ${processed} message(s) traité(s) (${processed - errors} envoyé(s), ${errors} erreur(s))`);
  }
}

setInterval(processQueue, 30000);

// ============ SERVE HTML ============
app.get('/health', (req, res) => {
  res.json({ status: 'ok', whatsapp: waStatus, ts: Date.now() });
});

app.get('/', (req, res) => {
  res.redirect('/parcoursup');
});

app.get('/parcoursup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'parcoursup.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Parcoursup CRM running on http://localhost:${PORT}/parcoursup\n`);
});
