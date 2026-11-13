const path = require('path');

// Configuration globale du serveur

const PORT = process.env.PORT || 3000;

// Cle secrete JWT (doit etre definie dans les variables d'environnement en prod)
const SECRET_KEY = process.env.JWT_SECRET || 'cle_secrete_temporaire_a_changer_en_production';
if (!process.env.JWT_SECRET) {
    console.warn('[SECURITE] Attention : JWT_SECRET non defini dans les variables d\'environnement !');
}

// Validation regex pour le nom d'utilisateur (3 a 30 caracteres alphanumeriques, tiret ou underscore)
const USERNAME_REGEX = /^[a-zA-Z0-9_\-\.]{3,30}$/;

// Limite maximale par fichier (512 Mo)
const MAX_FILE_SIZE = 512 * 1024 * 1024;

// Quota global de stockage pour les pieces jointes (20 Go par defaut, configurable via MAX_STORAGE_QUOTA)
const MAX_STORAGE_QUOTA = parseInt(process.env.MAX_STORAGE_QUOTA, 10) || (20 * 1024 * 1024 * 1024);

// Repertoire de stockage des uploads sur le serveur
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

// Duree de retention des fichiers (en jours avant nettoyage automatique des orphelins / archives)
const ATTACHMENT_TTL_DAYS = parseInt(process.env.ATTACHMENT_TTL_DAYS, 10) || 14;

module.exports = {
    PORT,
    SECRET_KEY,
    USERNAME_REGEX,
    MAX_FILE_SIZE,
    MAX_STORAGE_QUOTA,
    UPLOAD_DIR,
    ATTACHMENT_TTL_DAYS
};

