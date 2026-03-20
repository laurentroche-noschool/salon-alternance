const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const CRE_PIN        = process.env.CRE_PIN        || 'CRE2026';
const ENTERPRISE_PIN = process.env.ENTERPRISE_PIN || 'Salon2026';

const REGISTRATIONS_FILE = path.join(__dirname, 'data', 'registrations.json');
const COMPANIES_FILE     = path.join(__dirname, 'data', 'companies.json');
const RATINGS_FILE       = path.join(__dirname, 'data', 'ratings.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getCompanies() {
  return JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf8'));
}

function getRegistrations() {
  if (!fs.existsSync(REGISTRATIONS_FILE)) {
    fs.writeFileSync(REGISTRATIONS_FILE, JSON.stringify({}, null, 2), 'utf8');
  }
  return JSON.parse(fs.readFileSync(REGISTRATIONS_FILE, 'utf8'));
}

function saveRegistrations(data) {
  fs.writeFileSync(REGISTRATIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getRatings() {
  if (!fs.existsSync(RATINGS_FILE)) {
    fs.writeFileSync(RATINGS_FILE, JSON.stringify({}, null, 2), 'utf8');
  }
  try { return JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf8')); }
  catch { return {}; }
}

function saveRatings(data) {
  fs.writeFileSync(RATINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// GET all companies
app.get('/api/companies', (req, res) => {
  const companies = getCompanies();
  res.json(companies);
});

// GET one company
app.get('/api/companies/:id', (req, res) => {
  const companies = getCompanies();
  const company = companies.find(c => c.id === parseInt(req.params.id));
  if (!company) return res.status(404).json({ error: 'Entreprise non trouvée' });
  res.json(company);
});

// GET students for a company
app.get('/api/companies/:id/students', (req, res) => {
  const registrations = getRegistrations();
  const students = registrations[req.params.id] || [];
  res.json(students);
});

// POST add a student to a company (CRE only)
app.post('/api/companies/:id/students', (req, res) => {
  const { pin, nom, prenom, formation, cre } = req.body;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'PIN incorrect' });
  if (!nom || !prenom || !formation) return res.status(400).json({ error: 'Données incomplètes' });

  const registrations = getRegistrations();
  if (!registrations[req.params.id]) registrations[req.params.id] = [];

  const student = {
    id: Date.now().toString(),
    nom: nom.trim().toUpperCase(),
    prenom: prenom.trim(),
    formation: formation.trim(),
    cre: cre || '',
    createdAt: new Date().toISOString()
  };

  registrations[req.params.id].push(student);
  saveRegistrations(registrations);
  res.json(student);
});

// DELETE a student (CRE ou Entreprise)
app.delete('/api/companies/:id/students/:studentId', (req, res) => {
  const { pin } = req.body;
  if (pin !== CRE_PIN && pin !== ENTERPRISE_PIN)
    return res.status(401).json({ error: 'PIN incorrect' });

  const registrations = getRegistrations();
  if (!registrations[req.params.id]) return res.status(404).json({ error: 'Non trouvé' });

  registrations[req.params.id] = registrations[req.params.id].filter(s => s.id !== req.params.studentId);
  saveRegistrations(registrations);

  // Nettoyage du rating associé
  const ratings = getRatings();
  if (ratings[req.params.id] && ratings[req.params.id][req.params.studentId]) {
    delete ratings[req.params.id][req.params.studentId];
    saveRatings(ratings);
  }

  res.json({ success: true });
});

// POST verify CRE PIN
app.post('/api/auth/cre', (req, res) => {
  const { pin } = req.body;
  res.json({ valid: pin === CRE_PIN });
});

// POST verify Enterprise PIN
app.post('/api/auth/entreprise', (req, res) => {
  const { pin } = req.body;
  res.json({ valid: pin === ENTERPRISE_PIN });
});

// GET ratings for a company (enterprise)
app.get('/api/companies/:id/ratings', (req, res) => {
  const { pin } = req.query;
  if (pin !== ENTERPRISE_PIN) return res.status(401).json({ error: 'Non autorisé' });
  const ratings = getRatings();
  res.json(ratings[req.params.id] || {});
});

// POST save rating for a student (enterprise)
app.post('/api/companies/:id/ratings/:studentId', (req, res) => {
  const { pin, met, rating, comment } = req.body;
  if (pin !== ENTERPRISE_PIN) return res.status(401).json({ error: 'Non autorisé' });
  const ratings = getRatings();
  if (!ratings[req.params.id]) ratings[req.params.id] = {};
  ratings[req.params.id][req.params.studentId] = {
    met: met === true || met === 'true',
    rating: rating || null,
    comment: comment || '',
    updatedAt: new Date().toISOString()
  };
  saveRatings(ratings);
  res.json(ratings[req.params.id][req.params.studentId]);
});

// POST add spontaneous candidacy (enterprise)
app.post('/api/companies/:id/students/spontaneous', (req, res) => {
  const { pin, nom, prenom, formation, email, phone } = req.body;
  if (pin !== ENTERPRISE_PIN) return res.status(401).json({ error: 'Non autorisé' });
  if (!nom || !prenom || !formation) return res.status(400).json({ error: 'Données incomplètes' });
  const registrations = getRegistrations();
  if (!registrations[req.params.id]) registrations[req.params.id] = [];
  const student = {
    id: 'sp_' + Date.now().toString(),
    nom: nom.trim().toUpperCase(),
    prenom: prenom.trim(),
    formation: formation.trim(),
    email: (email || '').trim(),
    phone: (phone || '').trim(),
    spontaneous: true,
    cre: '',
    createdAt: new Date().toISOString()
  };
  registrations[req.params.id].push(student);
  saveRegistrations(registrations);
  res.json(student);
});

// GET detail d'une entreprise pour admin (étudiants + ratings)
app.get('/api/admin/companies/:id/detail', (req, res) => {
  const { pin } = req.query;
  if (pin !== ADMIN_PIN) return res.status(401).json({ error: 'Non autorisé' });
  const registrations = getRegistrations();
  const ratings = getRatings();
  const students = registrations[req.params.id] || [];
  const compRatings = ratings[req.params.id] || {};
  res.json({ students, ratings: compRatings });
});

// GET students detail for admin
app.get('/api/admin/students', (req, res) => {
  const { pin } = req.query;
  if (pin !== ADMIN_PIN) return res.status(401).json({ error: 'Non autorisé' });
  const companies = getCompanies(), registrations = getRegistrations(), ratings = getRatings();
  const compMap = {};
  companies.forEach(c => { compMap[c.id] = c; });
  const studentsMap = {};
  for (const [compId, students] of Object.entries(registrations)) {
    const comp = compMap[compId]; if (!comp) continue;
    const compRatings = ratings[compId] || {};
    students.forEach(s => {
      const key = `${(s.nom||'').toUpperCase()}__${(s.prenom||'').toLowerCase()}`;
      if (!studentsMap[key]) studentsMap[key] = { nom: s.nom||'', prenom: s.prenom||'', formation: s.formation||'', email: s.email||'', companies: [] };
      if ((s.formation||'').length > (studentsMap[key].formation||'').length) studentsMap[key].formation = s.formation;
      const r = compRatings[s.id] || {};
      studentsMap[key].companies.push({ id: parseInt(compId), nom: comp.nomAffichage||comp.nom, filiere: comp.filiere||'', spontaneous: !!s.spontaneous, met: r.met===true, rating: r.rating||null, comment: r.comment||'' });
    });
  }
  const students = Object.values(studentsMap).sort((a,b) => (a.nom||'').localeCompare(b.nom||''));
  res.json({ students, total: students.length });
});

// GET all registrations summary (CRE dashboard)
app.get('/api/registrations', (req, res) => {
  const { pin } = req.query;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'PIN incorrect' });
  res.json(getRegistrations());
});

// POST add a new company (CRE only — last-minute inscription)
app.post('/api/companies', (req, res) => {
  const { pin, nom, filiere, contact, secteur, website } = req.body;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'PIN incorrect' });
  if (!nom || !filiere) return res.status(400).json({ error: 'Nom et filière obligatoires' });

  const companies = getCompanies();
  const newId = Math.max(...companies.map(c => c.id), 0) + 1;
  const newCompany = {
    id: newId,
    nom: nom.trim(),
    nomAffichage: nom.trim(),
    filiere: filiere.trim(),
    cre: '',
    contact: (contact || '').trim(),
    website: (website || '').trim(),
    domain: '',
    secteur: (secteur || '').trim(),
    tagline: '',
    stand: { salle: '', etage: '' },
    description: '',
    histoire: '',
    valeurs: [],
    missions: [],
    concurrents: [],
    chiffres_cles: '',
    recrutement: '',
    questions_rh: [],
    questions_op: [],
    addedLive: true   // marqueur "ajoutée en live"
  };
  companies.push(newCompany);
  fs.writeFileSync(COMPANIES_FILE, JSON.stringify(companies, null, 2), 'utf8');
  res.json(newCompany);
});

// Update stand info for a company (CRE admin)
app.patch('/api/companies/:id/stand', (req, res) => {
  const { pin, salle, etage } = req.body;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'PIN incorrect' });

  const companies = getCompanies();
  const idx = companies.findIndex(c => c.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Non trouvé' });

  companies[idx].stand = { salle: salle || '', etage: etage || '' };
  fs.writeFileSync(COMPANIES_FILE, JSON.stringify(companies, null, 2), 'utf8');
  res.json(companies[idx]);
});

// Delete a company (special PIN)
const DELETE_COMPANY_PIN = 'PIN1402';
app.delete('/api/companies/:id', (req, res) => {
  const { pin } = req.body;
  if (pin !== DELETE_COMPANY_PIN) return res.status(401).json({ error: 'PIN incorrect' });

  const companies = getCompanies();
  const idx = companies.findIndex(c => c.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Entreprise non trouvée' });

  const removed = companies.splice(idx, 1)[0];
  fs.writeFileSync(COMPANIES_FILE, JSON.stringify(companies, null, 2), 'utf8');
  res.json({ success: true, removed });
});

// ── Admin PIN
const ADMIN_PIN = process.env.ADMIN_PIN || 'NS2026';

// POST verify admin PIN
app.post('/api/auth/admin', (req, res) => {
  const { pin } = req.body;
  res.json({ valid: pin === ADMIN_PIN });
});

// GET admin stats (synthèse complète du salon)
app.get('/api/admin/stats', (req, res) => {
  const { pin } = req.query;
  if (pin !== ADMIN_PIN) return res.status(401).json({ error: 'Non autorisé' });

  const companies    = getCompanies();
  const registrations= getRegistrations();
  const ratings      = getRatings();

  // ── Chiffres globaux
  const totalCompanies = companies.length;

  // Étudiants
  let totalStudents   = 0;
  let totalSpontaneous= 0;
  const companiesWithStudents = [];
  const companiesWithout = [];

  for (const company of companies) {
    const students = registrations[company.id] || [];
    const spontaneous = students.filter(s => s.spontaneous);
    totalStudents   += students.length;
    totalSpontaneous+= spontaneous.length;
    if (students.length > 0) companiesWithStudents.push({ company, students, spontaneous: spontaneous.length });
    else companiesWithout.push(company);
  }

  // Ratings
  let totalMet     = 0;
  let totalNotMet  = 0;
  let totalHire    = 0;
  let totalRetained= 0;
  let totalMaybe   = 0;
  let totalRefused = 0;
  let totalRated   = 0;

  for (const [companyId, compRatings] of Object.entries(ratings)) {
    for (const r of Object.values(compRatings)) {
      if (r.met === true)  totalMet++;
      if (r.met === false) totalNotMet++;
      if (r.rating) totalRated++;
      if (r.rating === 'hire')     totalHire++;
      if (r.rating === 'retained') totalRetained++;
      if (r.rating === 'maybe')    totalMaybe++;
      if (r.rating === 'refused')  totalRefused++;
    }
  }

  // ── Top entreprises (par nb étudiants)
  const topCompanies = [...companiesWithStudents]
    .sort((a, b) => b.students.length - a.students.length)
    .slice(0, 10)
    .map(({ company, students, spontaneous }) => ({
      id: company.id,
      nom: company.nomAffichage || company.nom,
      filiere: company.filiere,
      logoFile: company.logoFile || null,
      nbStudents: students.length,
      nbSpontaneous: spontaneous,
      nbMet: Object.values(ratings[company.id] || {}).filter(r => r.met).length,
      ratings: {
        hire:     Object.values(ratings[company.id] || {}).filter(r => r.rating === 'hire').length,
        retained: Object.values(ratings[company.id] || {}).filter(r => r.rating === 'retained').length,
        maybe:    Object.values(ratings[company.id] || {}).filter(r => r.rating === 'maybe').length,
        refused:  Object.values(ratings[company.id] || {}).filter(r => r.rating === 'refused').length,
      }
    }));

  // ── Répartition par filière
  const filieres = {};
  for (const c of companies) {
    const f = c.filiere || 'AUTRE';
    if (!filieres[f]) filieres[f] = { companies: 0, students: 0, hire: 0, retained: 0 };
    filieres[f].companies++;
    const students = registrations[c.id] || [];
    filieres[f].students += students.length;
    const cRatings = ratings[c.id] || {};
    filieres[f].hire     += Object.values(cRatings).filter(r => r.rating === 'hire').length;
    filieres[f].retained += Object.values(cRatings).filter(r => r.rating === 'retained').length;
  }

  // ── Détail par entreprise (pour tableau complet)
  const companiesDetail = companies.map(c => {
    const students = registrations[c.id] || [];
    const cRatings = ratings[c.id] || {};
    return {
      id: c.id,
      nom: c.nomAffichage || c.nom,
      filiere: c.filiere,
      logoFile: c.logoFile || null,
      nbStudents: students.length,
      nbSpontaneous: students.filter(s => s.spontaneous).length,
      nbMet: Object.values(cRatings).filter(r => r.met).length,
      hire:     Object.values(cRatings).filter(r => r.rating === 'hire').length,
      retained: Object.values(cRatings).filter(r => r.rating === 'retained').length,
      maybe:    Object.values(cRatings).filter(r => r.rating === 'maybe').length,
      refused:  Object.values(cRatings).filter(r => r.rating === 'refused').length,
    };
  });

  res.json({
    global: {
      totalCompanies,
      companiesWithStudents: companiesWithStudents.length,
      companiesWithout: companiesWithout.length,
      totalStudents,
      totalSpontaneous,
      totalPositioned: totalStudents - totalSpontaneous,
      totalMet,
      totalNotMet,
      totalRated,
      totalHire,
      totalRetained,
      totalMaybe,
      totalRefused,
    },
    topCompanies,
    filieres,
    companiesDetail,
    generatedAt: new Date().toISOString()
  });
});

// ── Presence tracking
const PRESENCE_FILE = path.join(__dirname, 'data', 'presence.json');
function getPresence() {
  if (!fs.existsSync(PRESENCE_FILE)) fs.writeFileSync(PRESENCE_FILE, '{}', 'utf8');
  try { return JSON.parse(fs.readFileSync(PRESENCE_FILE, 'utf8')); } catch { return {}; }
}
function savePresence(data) { fs.writeFileSync(PRESENCE_FILE, JSON.stringify(data, null, 2), 'utf8'); }

// CSV helper (UTF-8 BOM for Excel)
function toCSV(rows) {
  return '\ufeff' + rows.map(row =>
    row.map(cell => `"${String(cell == null ? '' : cell).replace(/"/g, '""')}"`).join(';')
  ).join('\r\n');
}

const RATING_LABELS_CSV = { hire: 'Je l\'embauche', retained: 'Retenu(e)', maybe: 'À voir', refused: 'Refusé(e)' };

// GET export candidates — Entreprise
app.get('/api/companies/:id/export-candidates', (req, res) => {
  const { pin } = req.query;
  if (pin !== ENTERPRISE_PIN) return res.status(401).json({ error: 'Non autorisé' });
  const company = getCompanies().find(c => c.id === parseInt(req.params.id));
  if (!company) return res.status(404).json({ error: 'Non trouvé' });
  const students = (getRegistrations()[req.params.id] || []);
  const ratings  = (getRatings()[req.params.id] || {});
  const rows = [['Nom', 'Prénom', 'Formation', 'Type', 'Email', 'Téléphone', 'Rencontré(e)', 'Décision', 'Commentaire', 'Date']];
  students.forEach(s => {
    const r = ratings[s.id] || {};
    rows.push([s.nom, s.prenom, s.formation,
      s.spontaneous ? 'Candidature spontanée' : 'Positionné(e) CRE',
      s.email || '', s.phone || '',
      r.met === true ? 'Oui' : r.met === false ? 'Non' : '',
      r.rating ? RATING_LABELS_CSV[r.rating] : '',
      r.comment || '',
      new Date(s.createdAt).toLocaleDateString('fr-FR')]);
  });
  const slug = (company.nomAffichage || company.nom).replace(/[^a-zA-Z0-9]/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="candidats_${slug}_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(toCSV(rows));
});

// GET export candidates — CRE (une entreprise)
app.get('/api/cre/companies/:id/export-candidates', (req, res) => {
  const { pin } = req.query;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'Non autorisé' });
  const company = getCompanies().find(c => c.id === parseInt(req.params.id));
  if (!company) return res.status(404).json({ error: 'Non trouvé' });
  const students = (getRegistrations()[req.params.id] || []);
  const ratings  = (getRatings()[req.params.id] || {});
  const rows = [['Entreprise', 'Filière', 'Nom', 'Prénom', 'Formation', 'Type', 'CRE', 'Rencontré(e)', 'Décision entreprise', 'Commentaire', 'Date']];
  students.forEach(s => {
    const r = ratings[s.id] || {};
    rows.push([company.nomAffichage || company.nom, company.filiere || '',
      s.nom, s.prenom, s.formation,
      s.spontaneous ? 'Spontanée' : 'CRE', s.cre || '',
      r.met === true ? 'Oui' : r.met === false ? 'Non' : '',
      r.rating ? RATING_LABELS_CSV[r.rating] : '',
      r.comment || '',
      new Date(s.createdAt).toLocaleDateString('fr-FR')]);
  });
  const slug = (company.nomAffichage || company.nom).replace(/[^a-zA-Z0-9]/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="CRE_${slug}_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(toCSV(rows));
});

// GET export présence (CRE)
app.get('/api/cre/presence/export', (req, res) => {
  const { pin } = req.query;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'Non autorisé' });
  const companies = getCompanies();
  const presence  = getPresence();
  const rows = [['Entreprise', 'Filière', 'Présent', 'Nb personnes sur le stand', 'Dernière MAJ']];
  [...companies]
    .sort((a, b) => (a.nomAffichage || a.nom).localeCompare(b.nomAffichage || b.nom))
    .forEach(c => {
      const p = presence[c.id] || { present: false, nbPersonnes: 0 };
      rows.push([
        c.nomAffichage || c.nom,
        c.filiere || '',
        p.present ? 'Oui' : 'Non',
        p.present ? (p.nbPersonnes || 0) : '',
        p.updatedAt ? new Date(p.updatedAt).toLocaleString('fr-FR') : ''
      ]);
    });
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="presence_entreprises_${date}.csv"`);
  res.send(toCSV(rows));
});

// GET presence data (CRE)
app.get('/api/cre/presence', (req, res) => {
  const { pin } = req.query;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'Non autorisé' });
  res.json(getPresence());
});

// POST update presence (CRE)
app.post('/api/cre/presence/:companyId', (req, res) => {
  const { pin, present, nbPersonnes } = req.body;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'Non autorisé' });
  const presence = getPresence();
  presence[req.params.companyId] = { present: !!present, nbPersonnes: parseInt(nbPersonnes) || 0, updatedAt: new Date().toISOString() };
  savePresence(presence);
  res.json(presence[req.params.companyId]);
});

// ─── Google Sheet Integration ─────────────────────────────────────────────────
const SHEET_CSV_URL    = 'https://docs.google.com/spreadsheets/d/1rafyD6PubGmF5F_nG2KBPg7g01325kiE7gzKkz8ED08/export?format=csv&gid=596889222';
const SHEET_LOCAL_FILE = path.join(__dirname, 'data', 'sheet-candidates-local.json');
const SHEET_CACHE_FILE = path.join(__dirname, 'data', 'sheet-candidates-cache.json');
const SELF_REG_FILE    = path.join(__dirname, 'data', 'self-registrations.json');

function getSelfRegistrations() {
  if (!fs.existsSync(SELF_REG_FILE)) fs.writeFileSync(SELF_REG_FILE, '[]', 'utf8');
  try { return JSON.parse(fs.readFileSync(SELF_REG_FILE, 'utf8')); } catch { return []; }
}
function saveSelfRegistrations(data) {
  fs.writeFileSync(SELF_REG_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getSheetLocal() {
  if (!fs.existsSync(SHEET_LOCAL_FILE)) fs.writeFileSync(SHEET_LOCAL_FILE, '{}', 'utf8');
  try { return JSON.parse(fs.readFileSync(SHEET_LOCAL_FILE, 'utf8')); } catch { return {}; }
}
function saveSheetLocal(d) { fs.writeFileSync(SHEET_LOCAL_FILE, JSON.stringify(d, null, 2), 'utf8'); }
function getSheetCache() {
  if (!fs.existsSync(SHEET_CACHE_FILE)) return { candidates: [], lastSync: null };
  try { return JSON.parse(fs.readFileSync(SHEET_CACHE_FILE, 'utf8')); } catch { return { candidates: [], lastSync: null }; }
}
function saveSheetCache(d) { fs.writeFileSync(SHEET_CACHE_FILE, JSON.stringify(d, null, 2), 'utf8'); }

function fetchURL(url, depth) {
  depth = depth || 0;
  return new Promise(function(resolve, reject) {
    if (depth > 5) return reject(new Error('Too many redirects'));
    var mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function(res) {
      if ([301,302,303,307,308].indexOf(res.statusCode) !== -1 && res.headers.location) {
        return resolve(fetchURL(res.headers.location, depth + 1));
      }
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() { resolve(data); });
    }).on('error', reject);
  });
}

function parseCSVLine(line) {
  var result = [], cur = '', inQ = false;
  for (var i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (line[i] === ',' && !inQ) { result.push(cur); cur = ''; }
    else cur += line[i];
  }
  result.push(cur);
  return result;
}

function parseSheetCSV(text) {
  var lines = text.replace(/^\ufeff/, '').trim().split('\n');
  if (lines.length < 2) return [];
  var headers = parseCSVLine(lines[0]).map(function(h) { return h.trim(); });
  return lines.slice(1).filter(function(l) { return l.trim(); }).map(function(l) {
    var vals = parseCSVLine(l);
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = (vals[i] || '').trim(); });
    return obj;
  });
}

function mapSheetRow(row) {
  return {
    inscritAt:     row['Horodateur'] || '',
    nom:           (row['Nom'] || '').trim().toUpperCase(),
    prenom:        (row['Prénom'] || '').trim(),
    tel:           (row['Téléphone'] || '').trim(),
    email:         (row['Email'] || '').trim().toLowerCase(),
    diplome:       (row['Ton dernier diplôme obtenu'] || '').trim(),
    domaines:      (row["Le ou les domaines qui t'attirent"] || '').trim(),
    situation:     (row['Ta situation actuelle'] || '').trim(),
    notesCandidat: (row['Tu souhaites nous préciser quelque chose ?'] || '').trim(),
  };
}

function getCandidateKey(c) {
  return (c.email && c.email.indexOf('@') !== -1) ? c.email : (c.nom + '__' + (c.prenom || '').toLowerCase());
}

function mergeCandidatesWithLocal(candidates) {
  var local = getSheetLocal();
  var registrations = getRegistrations();
  var companies = getCompanies();
  var nameToCompanies = {};
  companies.forEach(function(comp) {
    (registrations[comp.id] || []).forEach(function(s) {
      var k = (s.nom || '').toUpperCase() + '__' + (s.prenom || '').toLowerCase();
      if (!nameToCompanies[k]) nameToCompanies[k] = [];
      nameToCompanies[k].push({ id: comp.id, nom: comp.nomAffichage || comp.nom, filiere: comp.filiere || '' });
    });
  });
  return candidates.map(function(c) {
    var key = getCandidateKey(c);
    var loc = local[key] || {};
    var nameKey = c.nom + '__' + (c.prenom || '').toLowerCase();
    var compList = nameToCompanies[nameKey] || [];
    return Object.assign({}, c, {
      checkedIn:      loc.checkedIn || false,
      checkinAt:      loc.checkinAt || null,
      formationCiblee: loc.formationCiblee || '',
      notesCRE:       loc.notesCRE || '',
      nbCompanies:    compList.length,
      companies:      compList,
    });
  });
}

// GET /api/sheet-candidates
app.get('/api/sheet-candidates', function(req, res) {
  var pin = req.query.pin, refresh = req.query.refresh;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'PIN incorrect' });
  var cache = getSheetCache();
  var age = cache.lastSync ? (Date.now() - new Date(cache.lastSync).getTime()) : Infinity;
  var needRefresh = refresh === '1' || age > 5*60*1000 || !cache.candidates || !cache.candidates.length;
  function respond(c, offline) {
    // Inclure les auto-inscriptions validées absentes du Sheet
    var selfRegs = getSelfRegistrations().filter(function(r) { return r.status === 'validated'; });
    var emailSet = {};
    c.forEach(function(x) { if (x.email) emailSet[x.email] = true; });
    var extra = selfRegs.filter(function(r) { return !r.email || !emailSet[r.email]; }).map(function(r) {
      return { nom: r.nom, prenom: r.prenom, email: r.email, tel: r.telephone,
        diplome: r.diplome, domaines: r.domainesInteret,
        situation: 'Inscription sur place', notesCandidat: '', inscritAt: r.createdAt,
        selfRegistered: true, selfRegisteredId: r.id };
    });
    var merged = mergeCandidatesWithLocal(c.concat(extra));
    res.json({ candidates: merged, lastSync: cache.lastSync, total: merged.length, offline: !!offline });
  }
  if (!needRefresh) return respond(cache.candidates, false);
  fetchURL(SHEET_CSV_URL).then(function(csvText) {
    var rows = parseSheetCSV(csvText);
    var candidates = rows.map(mapSheetRow).filter(function(c) { return c.nom && c.prenom; });
    cache = { candidates: candidates, lastSync: new Date().toISOString() };
    saveSheetCache(cache);
    respond(candidates, false);
  }).catch(function(err) {
    if (cache.candidates && cache.candidates.length) return respond(cache.candidates, true);
    res.status(500).json({ error: 'Impossible de charger le Google Sheet: ' + err.message });
  });
});

// GET /api/sheet-candidates/list  (autocomplete — CRE + Entreprise)
app.get('/api/sheet-candidates/list', function(req, res) {
  var pin = req.query.pin;
  if (pin !== CRE_PIN && pin !== ENTERPRISE_PIN) return res.status(401).json({ error: 'PIN incorrect' });
  var cache = getSheetCache();
  var list = (cache.candidates || []).map(function(c) {
    return { nom: c.nom, prenom: c.prenom, email: c.email, tel: c.tel, diplome: c.diplome, domaines: c.domaines };
  });
  // Ajouter les auto-inscriptions validées
  var selfRegs2 = getSelfRegistrations().filter(function(r) { return r.status === 'validated'; });
  var emailSet2 = {};
  (cache.candidates || []).forEach(function(c) { if (c.email) emailSet2[c.email] = true; });
  selfRegs2.filter(function(r) { return !r.email || !emailSet2[r.email]; }).forEach(function(r) {
    list.push({ nom: r.nom, prenom: r.prenom, email: r.email, tel: r.telephone, diplome: r.diplome, domaines: r.domainesInteret });
  });
  res.json(list);
});

// POST /api/sheet-candidates/checkin
app.post('/api/sheet-candidates/checkin', function(req, res) {
  var pin = req.body.pin, key = req.body.key, checkedIn = req.body.checkedIn;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'PIN incorrect' });
  var local = getSheetLocal();
  if (!local[key]) local[key] = {};
  local[key].checkedIn = !!checkedIn;
  local[key].checkinAt = checkedIn ? new Date().toISOString() : null;
  saveSheetLocal(local);
  res.json({ success: true });
});

// POST /api/sheet-candidates/update
app.post('/api/sheet-candidates/update', function(req, res) {
  var pin = req.body.pin, key = req.body.key;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'PIN incorrect' });
  var local = getSheetLocal();
  if (!local[key]) local[key] = {};
  if (req.body.formationCiblee !== undefined) local[key].formationCiblee = (req.body.formationCiblee || '').trim();
  if (req.body.notesCRE !== undefined) local[key].notesCRE = (req.body.notesCRE || '').trim();
  saveSheetLocal(local);
  res.json({ success: true });
});

// GET /api/sheet-candidates/export
app.get('/api/sheet-candidates/export', function(req, res) {
  var pin = req.query.pin;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'Non autorisé' });
  var cache = getSheetCache();
  var merged = mergeCandidatesWithLocal(cache.candidates || []);
  var rows = [['Nom','Prénom','Téléphone','Email','Dernier diplôme','Domaines d\'intérêt','Situation','Formation ciblée','Présent(e)','Heure check-in','Nb entreprises positionnées','Notes CRE','Date inscription']];
  merged.forEach(function(c) {
    rows.push([
      c.nom, c.prenom, c.tel, c.email, c.diplome, c.domaines, c.situation,
      c.formationCiblee,
      c.checkedIn ? 'Oui' : 'Non',
      c.checkinAt ? new Date(c.checkinAt).toLocaleString('fr-FR') : '',
      c.nbCompanies, c.notesCRE, c.inscritAt
    ]);
  });
  var date = new Date().toISOString().slice(0,10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="candidats_inscrits_' + date + '.csv"');
  res.send(toCSV(rows));
});

// ─── Auto-inscriptions sur place ─────────────────────────────────────────────

// POST /api/self-register  (sans auth — accès public)
app.post('/api/self-register', function(req, res) {
  var nom = (req.body.nom || '').trim().toUpperCase();
  var prenom = (req.body.prenom || '').trim();
  if (!nom || !prenom) return res.status(400).json({ error: 'Nom et prénom obligatoires' });
  var reg = {
    id: 'sr_' + Date.now().toString(),
    nom: nom, prenom: prenom,
    email:          (req.body.email || '').trim().toLowerCase(),
    telephone:      (req.body.telephone || '').trim(),
    diplome:        (req.body.diplome || '').trim(),
    ecole:          (req.body.ecole || '').trim(),
    domainesInteret:(req.body.domainesInteret || '').trim(),
    companyId:      req.body.companyId || null,
    companyName:    (req.body.companyName || '').trim(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    validatedAt: null, rejectedAt: null
  };
  var regs = getSelfRegistrations();
  regs.push(reg);
  saveSelfRegistrations(regs);
  res.json({ success: true, id: reg.id });
});

// GET /api/self-register/pending  (CRE seulement)
app.get('/api/self-register/pending', function(req, res) {
  var pin = req.query.pin;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'PIN incorrect' });
  var regs = getSelfRegistrations().filter(function(r) { return r.status === 'pending'; });
  res.json({ registrations: regs, total: regs.length });
});

// GET /api/self-register/all  (CRE export)
app.get('/api/self-register/all', function(req, res) {
  var pin = req.query.pin;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'PIN incorrect' });
  res.json({ registrations: getSelfRegistrations() });
});

// POST /api/self-register/:id/validate  (CRE)
app.post('/api/self-register/:id/validate', function(req, res) {
  var pin = req.body.pin;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'PIN incorrect' });
  var regs = getSelfRegistrations();
  var idx = regs.findIndex(function(r) { return r.id === req.params.id; });
  if (idx === -1) return res.status(404).json({ error: 'Non trouvé' });
  regs[idx].status = 'validated';
  regs[idx].validatedAt = new Date().toISOString();
  saveSelfRegistrations(regs);
  // Initialiser l'entrée locale pour ce candidat
  var local = getSheetLocal();
  var key = regs[idx].email || (regs[idx].nom + '__' + regs[idx].prenom.toLowerCase());
  if (!local[key]) local[key] = {};
  local[key].selfRegistered = true;
  saveSheetLocal(local);
  res.json({ success: true, candidate: regs[idx] });
});

// DELETE /api/self-register/:id  (CRE — annulation d'une validation par erreur)
app.delete('/api/self-register/:id', function(req, res) {
  var pin = req.body.pin;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'PIN incorrect' });
  var regs = getSelfRegistrations();
  var idx = regs.findIndex(function(r) { return r.id === req.params.id; });
  if (idx === -1) return res.status(404).json({ error: 'Non trouvé' });
  var reg = regs[idx];
  // Remettre en "rejected" plutôt que supprimer pour garder la trace
  regs[idx].status = 'rejected';
  regs[idx].rejectedAt = new Date().toISOString();
  saveSelfRegistrations(regs);
  // Nettoyer l'entrée locale
  var local = getSheetLocal();
  var key = reg.email || (reg.nom + '__' + reg.prenom.toLowerCase());
  if (local[key] && local[key].selfRegistered) delete local[key];
  saveSheetLocal(local);
  res.json({ success: true });
});

// POST /api/self-register/:id/reject  (CRE)
app.post('/api/self-register/:id/reject', function(req, res) {
  var pin = req.body.pin;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'PIN incorrect' });
  var regs = getSelfRegistrations();
  var idx = regs.findIndex(function(r) { return r.id === req.params.id; });
  if (idx === -1) return res.status(404).json({ error: 'Non trouvé' });
  regs[idx].status = 'rejected';
  regs[idx].rejectedAt = new Date().toISOString();
  saveSelfRegistrations(regs);
  res.json({ success: true });
});

// GET /api/admin/self-registrations (Admin)
app.get('/api/admin/self-registrations', function(req, res) {
  var pin = req.query.pin;
  if (pin !== ADMIN_PIN) return res.status(401).json({ error: 'Non autorisé' });
  var regs = getSelfRegistrations();
  var pending   = regs.filter(function(r) { return r.status === 'pending'; });
  var validated = regs.filter(function(r) { return r.status === 'validated'; });
  var rejected  = regs.filter(function(r) { return r.status === 'rejected'; });
  res.json({
    total: regs.length,
    nbPending: pending.length,
    nbValidated: validated.length,
    nbRejected: rejected.length,
    registrations: regs.sort(function(a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })
  });
});

// GET export inscriptions sur place (CRE)
app.get('/api/self-register/export', function(req, res) {
  var pin = req.query.pin;
  if (pin !== CRE_PIN) return res.status(401).json({ error: 'Non autorisé' });
  var regs = getSelfRegistrations();
  var statusLabel = { pending: 'En attente', validated: 'Validé', rejected: 'Refusé' };
  var rows = [['Statut','Nom','Prénom','Email','Téléphone','Diplôme','École','Domaines','Entreprise d\'intérêt','Date inscription','Date validation']];
  regs.forEach(function(r) {
    rows.push([
      statusLabel[r.status] || r.status,
      r.nom, r.prenom, r.email, r.telephone, r.diplome, r.ecole, r.domainesInteret,
      r.companyName || '',
      r.createdAt ? new Date(r.createdAt).toLocaleString('fr-FR') : '',
      r.validatedAt ? new Date(r.validatedAt).toLocaleString('fr-FR') : ''
    ]);
  });
  var date = new Date().toISOString().slice(0,10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="inscriptions_sur_place_' + date + '.csv"');
  res.send(toCSV(rows));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('\n========================================');
  console.log('   SALON ALTERNANCE - Application');
  console.log('========================================');
  console.log(`Accès local  : http://localhost:${PORT}`);
  console.log(`Accès réseau : http://[votre-ip]:${PORT}`);
  console.log(`PIN CRE      : ${CRE_PIN}`);
  console.log('========================================\n');
});
