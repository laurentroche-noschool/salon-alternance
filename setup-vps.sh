#!/bin/bash
# ============================================================
# Script d'installation VPS - CRM Parcoursup
# Pour Ubuntu 22.04 (OVH VPS Starter)
# ============================================================
# Usage: ssh root@IP_DU_VPS puis copier-coller ce script
# ============================================================

set -e

echo "=========================================="
echo "  Installation CRM Parcoursup"
echo "=========================================="

# 1. Mise a jour systeme
echo "[1/7] Mise a jour du systeme..."
apt update && apt upgrade -y

# 2. Installer Node.js 20
echo "[2/7] Installation de Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. Installer Chromium (pour WhatsApp)
echo "[3/7] Installation de Chromium..."
apt install -y chromium-browser || apt install -y chromium
echo "Chromium installe: $(which chromium-browser || which chromium)"

# 4. Installer Git
echo "[4/7] Installation de Git..."
apt install -y git

# 5. Cloner le projet
echo "[5/7] Clonage du projet..."
cd /opt
if [ -d "salon-alternance" ]; then
  echo "Le dossier existe deja, mise a jour..."
  cd salon-alternance
  git pull
else
  git clone https://github.com/laurentroche-noschool/salon-alternance.git
  cd salon-alternance
fi

# 6. Installer les dependances
echo "[6/7] Installation des dependances npm..."
npm install

# Creer le dossier data s'il n'existe pas
mkdir -p data

# 7. Creer le fichier de configuration environnement
echo "[7/7] Configuration..."
cat > /opt/salon-alternance/.env.parcoursup <<'ENVEOF'
# ============ CONFIGURATION CRM PARCOURSUP ============
# Port du serveur
PORT=3002

# Code PIN d'acces (celui que tu donnes a tes equipes)
PARCOURSUP_PIN=NSWILL26

# Configuration SMTP (Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=laurent.roche@will.school
SMTP_PASS=pakc mmkn ojuu zrkq
SMTP_FROM_NAME=Service Admissions
ENVEOF

echo ""
echo ">> Fichier .env.parcoursup cree. Modifie-le si besoin :"
echo "   nano /opt/salon-alternance/.env.parcoursup"
echo ""

# Creer le service systemd (demarrage automatique)
cat > /etc/systemd/system/parcoursup.service <<'SVCEOF'
[Unit]
Description=CRM Parcoursup
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/salon-alternance
EnvironmentFile=/opt/salon-alternance/.env.parcoursup
ExecStart=/usr/bin/node parcoursup-server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Chromium/Puppeteer needs these
Environment=PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SVCEOF

# Activer et demarrer le service
systemctl daemon-reload
systemctl enable parcoursup
systemctl start parcoursup

# Installer et configurer le pare-feu
apt install -y ufw
ufw allow 22/tcp
ufw allow 3002/tcp
ufw --force enable

echo ""
echo "=========================================="
echo "  INSTALLATION TERMINEE !"
echo "=========================================="
echo ""
echo "  L'app tourne sur : http://$(hostname -I | awk '{print $1}'):3002/parcoursup"
echo ""
echo "  Commandes utiles :"
echo "    Voir les logs     : journalctl -u parcoursup -f"
echo "    Redemarrer        : systemctl restart parcoursup"
echo "    Arreter           : systemctl stop parcoursup"
echo "    Mettre a jour     : cd /opt/salon-alternance && git pull && systemctl restart parcoursup"
echo ""
echo "  PROCHAINE ETAPE :"
echo "    1. Ouvre http://IP_DU_VPS:3002/parcoursup dans ton navigateur"
echo "    2. Connecte-toi avec le PIN : NSWILL26"
echo "    3. Va dans Automatisations > Connecter WhatsApp"
echo "    4. Scanne le QR Code avec ton telephone"
echo "    5. C'est parti ! Email + WhatsApp 24/7"
echo ""
