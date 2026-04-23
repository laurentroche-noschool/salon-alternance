# Salon Alternance - Job Dating Platform

## Projet

Plateforme de job dating pour Will.School & Noschool Bordeaux. Gestion des candidats, entreprises, coordinateurs (CRE) et admins lors d'un salon d'alternance. Inclut un CRM Parcoursup et un hub d'admission.

## Stack

- **Backend:** Node.js + Express
- **Frontend:** Vanilla JS (app principale), React 18 + Babel (Parcoursup)
- **Base de donnees:** Supabase (PostgreSQL, RLS active)
- **Communication:** Nodemailer (email), whatsapp-web.js (WhatsApp)
- **UI:** CSS custom, Font Awesome 6.5, Google Fonts (Inter)

## Architecture - 4 serveurs independants

| Serveur | Fichier | Port | Role |
|---------|---------|------|------|
| Principal | `server.js` | 3000 | Job dating (50+ API routes) |
| Admission Hub | `admission-server.js` | 3001 | Proxy/scraper CRM externe |
| Parcoursup | `parcoursup-server.js` | 3002 | CRM admissions, automations, WhatsApp |
| Cockpit | `cockpit-server.js` | 3003 | Tableau de bord global (Puppeteer) |

## Demarrage

```bash
npm start                     # server.js (port 3000)
npm run start:parcoursup      # parcoursup-server.js (port 3002)
```

Variables d'environnement requises dans `.env` :
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `CRE_PIN`, `ENTERPRISE_PIN`, `ADMIN_PIN`
- `SHEET_CSV_URL` (optionnel, import Google Sheets)

## Structure

```
server.js                  # Serveur principal (~1570 lignes)
parcoursup-server.js       # CRM Parcoursup (~1960 lignes)
admission-server.js        # Hub admission (~640 lignes)
cockpit-server.js          # Cockpit / dashboard global (~740 lignes)
download-logos.js          # Script one-shot d'import de logos
setup-vps.sh               # Provisionning initial du VPS Ubuntu
auto-deploy.sh             # Cron de deploiement (cf. section Deploiement)
public/
  index.html               # UI principale (SPA, ~1000 lignes)
  parcoursup.html          # Interface Parcoursup (React CDN, ~4080 lignes)
  admission.html           # UI Hub admission (~1890 lignes)
  cockpit.html             # UI Cockpit (~1950 lignes)
  js/app.js                # Logique frontend principale (~3700 lignes)
  css/style.css            # Styles partages (~3000 lignes)
  images/logos/            # 60+ logos entreprises
data/                      # Donnees locales JSON + auth WhatsApp (.wwebjs_auth)
.github/workflows/
  deploy-vps.yml           # Deploiement automatique sur push (cf. Deploiement)
  keep-alive.yml           # Cron GitHub Actions pour garder le VPS eveille
schema-supabase.sql        # Schema BDD
```

## Conventions

- **JS:** camelCase pour les variables, UPPERCASE pour les constantes
- **HTML/CSS:** kebab-case pour IDs et classes
- **SQL:** snake_case pour tables et colonnes
- **Langue:** Code et UI en francais
- **Auth:** PINs simples (pas de comptes utilisateurs)
- **Exports:** CSV UTF-8 BOM (compatibilite Excel)

## Base de donnees (tables principales)

- `companies` - Entreprises participantes (infos, stand, filiere)
- `students` - Candidats positionnes par les entreprises
- `ratings` - Decisions entreprises sur candidats
- `presence` - Suivi presence entreprises
- `sheet_local` - Check-in et notes CRE
- `self_registrations` - Inscriptions sur place

## Points d'attention

- WhatsApp necessite un scan QR initial, degradation gracieuse si indisponible
- Les fichiers serveur sont volumineux (1500+ lignes chacun) - lire les sections pertinentes avec offset/limit
- Frontend = SPA avec machine a etats dans app.js (screens: home, student, entreprise, cre, admin)
- Parcoursup utilise React via CDN + Babel (pas de build step)
- Donnees sensibles dans `/data/` et `.env` / `.env.parcoursup` - jamais committer (dans .gitignore)

## Appli en ligne

- **URL Parcoursup :** http://51.77.223.57:3002/parcoursup
- **PIN d'acces :** `NSWILL26` (saisi dans l'UI, puis garde en `sessionStorage`)
- **Health check :** http://51.77.223.57:3002/health (doit retourner `{"status":"ok"}`)
- **Host :** VPS OVH Starter, Ubuntu, service systemd `parcoursup`

## Deploiement

**Deux mecanismes complementaires deployent automatiquement sur le VPS :**

1. **GitHub Actions `deploy-vps.yml`** (principal) : se declenche sur chaque push sur `main` ou
   toute branche `claude/**`. Se connecte en SSH au VPS (secrets `VPS_HOST`, `VPS_USER`,
   `VPS_PASSWORD`), fait `git fetch` + `git reset --hard`, sauvegarde puis restaure
   `data/parcoursup-*.json` et `.env.parcoursup`, fait `npm install` uniquement si
   `package.json` a change, puis `systemctl restart parcoursup` + health check.
2. **Cron `auto-deploy.sh`** (fallback) : execute chaque minute sur le VPS via crontab.
   Poll la branche `claude/parcoursup-crm-tasks-2GW6m`, compare `HEAD` local et distant,
   et applique la meme procedure si un nouveau commit est detecte. Sert de filet de
   securite si Actions tombe.

**Branche de travail principale pour le deploiement :** `claude/parcoursup-crm-tasks-2GW6m`

Flow de travail type :
```bash
git checkout claude/parcoursup-crm-tasks-2GW6m
# ... modifier le code ...
git commit -m "feat(parcoursup): description"
git push origin claude/parcoursup-crm-tasks-2GW6m
# Le VPS se met a jour automatiquement sous 1-2 minutes
```

## Setup sur un nouveau PC

Les conversations Claude/Cowork ne persistent pas entre PCs : tout le contexte doit
vivre dans ce repo. Pour reprendre le travail sur une nouvelle machine :

```bash
# 1. Cloner
git clone https://github.com/laurentroche-noschool/salon-alternance.git
cd salon-alternance

# 2. Configurer l'identite git (email correct, pas la coquille "rochelaureCnt")
git config user.name "Laurent ROCHE"
git config user.email "rochelaurent@hotmail.fr"

# 3. Installer GitHub CLI et s'authentifier (macOS : via Homebrew)
brew install gh
gh auth login   # choisir GitHub.com > HTTPS > login browser

# 4. Se mettre sur la branche de deploiement
git checkout claude/parcoursup-crm-tasks-2GW6m
git pull

# 5. (Optionnel, pour tester en local) Installer les deps et lancer le serveur
npm install
cp .env.example .env.parcoursup  # si present, sinon demander le fichier
node parcoursup-server.js
```

Ensuite, dans Cowork : donner ce CLAUDE.md a Claude au premier message suffit pour
qu'il reprenne le contexte.
