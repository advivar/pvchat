// Configuration globale du serveur

const PORT = process.env.PORT || 3000;

// Cle secrete JWT (doit etre definie dans les variables d'environnement en prod)
const SECRET_KEY = process.env.JWT_SECRET || 'cle_secrete_temporaire_a_changer_en_production';
if (!process.env.JWT_SECRET) {
    console.warn('[SECURITE] Attention : JWT_SECRET non defini dans les variables d\'environnement !');
}

// Validation regex pour le nom d'utilisateur (3 a 30 caracteres alphanumeriques, tiret ou underscore)
const USERNAME_REGEX = /^[a-zA-Z0-9_\-\.]{3,30}$/;

module.exports = {
    PORT,
    SECRET_KEY,
    USERNAME_REGEX
};

