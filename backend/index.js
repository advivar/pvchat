const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();

// Masque le header X-Powered-By pour ne pas exposer Express
app.disable('x-powered-by');

// Fait confiance au reverse proxy Nginx pour recuperer la vraie IP client
app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(cors());

// Connexion PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// Cle secrete JWT (doit etre definie dans les variables d'environnement en prod)
const SECRET_KEY = process.env.JWT_SECRET || 'cle_secrete_temporaire_a_changer_en_production';
if (!process.env.JWT_SECRET) {
    console.warn('[SECURITE] Attention : JWT_SECRET non defini dans les variables d\'environnement !');
}

// Validation regex pour le nom d'utilisateur (3 a 30 caracteres alphanumeriques, tiret ou underscore)
const USERNAME_REGEX = /^[a-zA-Z0-9_\-\.]{3,30}$/;

// Rate limiting simple en memoire (protection anti brute-force et anti spam)
const rateLimits = new Map();

function rateLimiter(windowMs, maxRequests) {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const now = Date.now();
        const record = rateLimits.get(ip) || { count: 0, resetTime: now + windowMs };

        if (now > record.resetTime) {
            record.count = 1;
            record.resetTime = now + windowMs;
        } else {
            record.count += 1;
        }

        rateLimits.set(ip, record);

        if (record.count > maxRequests) {
            return res.status(429).json({ error: 'Trop de requêtes. Veuillez patienter un moment.' });
        }

        next();
    };
}

// Nettoyage de la memoire du rate limiter chaque minute
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimits.entries()) {
        if (now > value.resetTime) {
            rateLimits.delete(key);
        }
    }
}, 60000);

// Initialisation des tables si elles n'existent pas
async function initDb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                user1_id INT REFERENCES users(id) ON DELETE CASCADE,
                user2_id INT REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_conversation UNIQUE (user1_id, user2_id)
            );

            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE,
                sender_id INT REFERENCES users(id) ON DELETE CASCADE,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Base de donnees initialisee avec succes.');
    } catch (err) {
        console.error('Erreur initialisation BDD :', err);
    }
}

// Verification du token JWT
function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Non connecte' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token manquant' });

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Session expiree ou invalide' });
        req.user = decoded;
        next();
    });
}

// Inscription (limite a 5 essais par minute par IP)
app.post('/register', rateLimiter(60000, 5), async (req, res) => {
    const { username, password } = req.body;

    if (!username || typeof username !== 'string' || !USERNAME_REGEX.test(username.trim())) {
        return res.status(400).json({
            error: 'Le nom d\'utilisateur doit contenir entre 3 et 30 caractères (lettres, chiffres, tirets, points).'
        });
    }

    if (!password || typeof password !== 'string' || password.length < 6 || password.length > 128) {
        return res.status(400).json({
            error: 'Le mot de passe doit contenir entre 6 et 128 caractères.'
        });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
            [username.trim(), hashedPassword]
        );
        res.status(201).json({ message: 'Compte cree', user: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Ce nom d\'utilisateur existe deja.' });
        }
        console.error('Erreur inscription :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Connexion (limite a 10 essais par minute par IP pour contrer le brute-force)
app.post('/login', rateLimiter(60000, 10), async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Identifiants incomplets.' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username.trim()]);
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Identifiants incorrects.' });
        }

        const token = jwt.sign({ userId: user.id, username: user.username }, SECRET_KEY, { expiresIn: '24h' });
        res.json({ message: 'Connexion reussie', token, user: { id: user.id, username: user.username } });
    } catch (err) {
        console.error('Erreur connexion :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Recupere l'utilisateur actuel
app.get('/me', authMiddleware, (req, res) => {
    res.json({ user: req.user });
});

// Recherche des utilisateurs pour autocompletion
app.get('/users/search', authMiddleware, async (req, res) => {
    const rawQuery = String(req.query.q || '').trim().slice(0, 50);
    if (!rawQuery) return res.json([]);

    try {
        const result = await pool.query(
            'SELECT id, username FROM users WHERE username ILIKE $1 AND id != $2 ORDER BY username ASC LIMIT 10',
            [`%${rawQuery}%`, req.user.userId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Erreur recherche users :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Liste des conversations de l'utilisateur
app.get('/conversations', authMiddleware, async (req, res) => {
    const userId = req.user.userId;

    try {
        const query = `
            SELECT 
                c.id,
                c.created_at,
                CASE WHEN c.user1_id = $1 THEN u2.id ELSE u1.id END AS other_user_id,
                CASE WHEN c.user1_id = $1 THEN u2.username ELSE u1.username END AS other_username,
                (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
                (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_date
            FROM conversations c
            JOIN users u1 ON c.user1_id = u1.id
            JOIN users u2 ON c.user2_id = u2.id
            WHERE c.user1_id = $1 OR c.user2_id = $1
            ORDER BY COALESCE(
                (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1),
                c.created_at
            ) DESC
        `;
        const result = await pool.query(query, [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Erreur recup conversations :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Creer ou recuperer une conversation existante (pas de doublon)
app.post('/conversations', authMiddleware, async (req, res) => {
    const currentUserId = req.user.userId;
    let targetUserId = parseInt(req.body.targetUserId);

    if (isNaN(targetUserId)) {
        return res.status(400).json({ error: 'Destinataire invalide.' });
    }

    if (currentUserId === targetUserId) {
        return res.status(400).json({ error: 'Impossible de creer un chat avec vous-meme.' });
    }

    try {
        // Tri des IDs pour la contrainte unique
        const u1 = Math.min(currentUserId, targetUserId);
        const u2 = Math.max(currentUserId, targetUserId);

        // Verifie si deja existant
        const existing = await pool.query(
            `SELECT c.id,
                    CASE WHEN c.user1_id = $1 THEN u2.id ELSE u1.id END AS other_user_id,
                    CASE WHEN c.user1_id = $1 THEN u2.username ELSE u1.username END AS other_username
             FROM conversations c
             JOIN users u1 ON c.user1_id = u1.id
             JOIN users u2 ON c.user2_id = u2.id
             WHERE c.user1_id = $2 AND c.user2_id = $3`,
            [currentUserId, u1, u2]
        );

        if (existing.rows.length > 0) {
            return res.json({ conversation: existing.rows[0], alreadyExists: true });
        }

        // Creation de la conversation
        const insert = await pool.query(
            'INSERT INTO conversations (user1_id, user2_id) VALUES ($1, $2) RETURNING id',
            [u1, u2]
        );

        const newId = insert.rows[0].id;
        const target = await pool.query('SELECT id, username FROM users WHERE id = $1', [targetUserId]);

        if (target.rows.length === 0) {
            return res.status(404).json({ error: 'Utilisateur introuvable.' });
        }

        res.status(201).json({
            conversation: {
                id: newId,
                other_user_id: target.rows[0].id,
                other_username: target.rows[0].username,
                last_message: null
            },
            alreadyExists: false
        });
    } catch (err) {
        console.error('Erreur creation conversation :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Messages d'une conversation (verifie l'appartenance)
app.get('/conversations/:id/messages', authMiddleware, async (req, res) => {
    const convId = parseInt(req.params.id);
    const userId = req.user.userId;

    if (isNaN(convId)) {
        return res.status(400).json({ error: 'ID de conversation invalide.' });
    }

    try {
        const check = await pool.query(
            'SELECT id FROM conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
            [convId, userId]
        );
        if (check.rows.length === 0) {
            return res.status(403).json({ error: 'Acces refuse a cette conversation.' });
        }

        const msgs = await pool.query(
            `SELECT m.id, m.conversation_id, m.sender_id, u.username AS sender_name, m.content, m.created_at
             FROM messages m
             JOIN users u ON m.sender_id = u.id
             WHERE m.conversation_id = $1
             ORDER BY m.created_at ASC`,
            [convId]
        );

        res.json(msgs.rows);
    } catch (err) {
        console.error('Erreur chargement messages :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Envoyer un message (limite a 20 messages par 10s pour eviter le spam)
app.post('/conversations/:id/messages', authMiddleware, rateLimiter(10000, 20), async (req, res) => {
    const convId = parseInt(req.params.id);
    const userId = req.user.userId;
    const { content } = req.body;

    if (isNaN(convId)) {
        return res.status(400).json({ error: 'ID de conversation invalide.' });
    }

    if (!content || typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: 'Message vide.' });
    }

    if (content.length > 5000) {
        return res.status(400).json({ error: 'Le message est trop long (maximum 5000 caractères).' });
    }

    try {
        const check = await pool.query(
            'SELECT user1_id, user2_id FROM conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
            [convId, userId]
        );
        if (check.rows.length === 0) {
            return res.status(403).json({ error: 'Acces refuse.' });
        }

        const conv = check.rows[0];

        const insert = await pool.query(
            'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3) RETURNING id, conversation_id, sender_id, content, created_at',
            [convId, userId, content.trim()]
        );

        const newMsg = insert.rows[0];
        newMsg.sender_name = req.user.username;

        // Diffusion websocket UNIQUEMENT aux deux participants autorises
        broadcastToConversation([conv.user1_id, conv.user2_id], {
            type: 'new_message',
            message: newMsg
        });

        res.status(201).json(newMsg);
    } catch (err) {
        console.error('Erreur envoi message :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// --- WEBSOCKET TEMPS REEL SECURISE ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    // Authentification obligatoire par token JWT via query param (?token=...)
    try {
        const url = new URL(req.url, 'http://localhost');
        const token = url.searchParams.get('token');

        if (!token) {
            ws.close(4001, 'Token manquant');
            return;
        }

        jwt.verify(token, SECRET_KEY, (err, decoded) => {
            if (err) {
                ws.close(4002, 'Token invalide');
                return;
            }
            ws.userId = decoded.userId;
            ws.username = decoded.username;
        });
    } catch (e) {
        ws.close(4000, 'Erreur de connexion');
    }

    ws.on('error', () => {});
});

// Diffuse uniquement aux destinataires autorises (confidentialite stricte)
function broadcastToConversation(participantIds, data) {
    const payload = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && participantIds.includes(client.userId)) {
            client.send(payload);
        }
    });
}

// Lancement
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
    await initDb();
    console.log(`Serveur PVCHAT ecoute sur port ${PORT}`);
});
