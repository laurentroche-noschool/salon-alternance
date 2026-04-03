# Salon Alternance - Job Dating Platform

## Projet

Plateforme de job dating pour Will.School & Noschool Bordeaux. Gestion des candidats, entreprises, coordinateurs (CRE) et admins lors d'un salon d'alternance. Inclut un CRM Parcoursup et un hub d'admission.

## Stack

- **Backend:** Node.js + Express
- **Frontend:** Vanilla JS (app principale), React 18 + Babel (Parcoursup)
- **Base de donnees:** Supabase (PostgreSQL, RLS active)
- **Communication:** Nodemailer (email), whatsapp-web.js (WhatsApp)
- **UI:** CSS custom, Font Awesome 6.5, Google Fonts (Inter)

## Architecture - 3 serveurs independants

| Serveur | Fichier | Port | Role |
|---------|---------|------|------|
| Principal | `server.js` | 3000 | Job dating (50+ API routes) |
| Parcoursup | `parcoursup-server.js` | 3002 | CRM admissions, automations |
| Admission Hub | `admission-server.js` | 3001 | Proxy/scraper CRM externe |

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
server.js                  # Serveur principal (1500+ lignes)
parcoursup-server.js       # CRM Parcoursup (1200+ lignes)
admission-server.js        # Hub admission (640+ lignes)
public/
  index.html               # UI principale (SPA)
  parcoursup.html           # Interface Parcoursup (React)
  js/app.js                # Logique frontend (3700+ lignes)
  css/style.css            # Styles (3000+ lignes)
  images/logos/            # 60+ logos entreprises
data/                      # Donnees locales, auth WhatsApp
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
- Les fichiers serveur sont volumineux (1000+ lignes chacun) - lire les sections pertinentes
- Frontend = SPA avec machine a etats dans app.js (screens: home, student, entreprise, cre, admin)
- Parcoursup utilise React via CDN + Babel (pas de build step)
- Donnees sensibles dans `/data/` et `.env` - jamais committer
