// Routes de gestion des conversations et des messages

const express = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db/pool');
const authMiddleware = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');
const { broadcastToConversation } = require('../ws/socket');

const router = express.Router();

// Liste des conversations de l'utilisateur (exclut les conversations masquees)
router.get('/', authMiddleware, async (req, res) => {
    const userId = req.user.userId;

    try {
        const query = `
            SELECT 
                c.id,
                c.created_at,
                CASE WHEN c.user1_id = $1 THEN u2.id ELSE u1.id END AS other_user_id,
                CASE WHEN c.user1_id = $1 THEN u2.username ELSE u1.username END AS other_username,
                (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
                (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_date,
                COALESCE(cs.is_hidden, FALSE) AS is_hidden,
                CASE WHEN cs.password_hash IS NOT NULL THEN TRUE ELSE FALSE END AS has_password
            FROM conversations c
            JOIN users u1 ON c.user1_id = u1.id
            JOIN users u2 ON c.user2_id = u2.id
            LEFT JOIN conversation_settings cs ON cs.conversation_id = c.id AND cs.user_id = $1
            WHERE (c.user1_id = $1 OR c.user2_id = $1)
              AND COALESCE(cs.is_hidden, FALSE) = FALSE
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

// Creer ou recuperer une conversation existante (pas de doublon, reactive si masquee)
router.post('/', authMiddleware, async (req, res) => {
    const currentUserId = req.user.userId;
    let targetUserId = parseInt(req.body.targetUserId);

    if (isNaN(targetUserId)) {
        return res.status(400).json({ error: 'Destinataire invalide.' });
    }

    if (currentUserId === targetUserId) {
        return res.status(400).json({ error: 'Impossible de creer un chat avec vous-meme.' });
    }

    try {
        const u1 = Math.min(currentUserId, targetUserId);
        const u2 = Math.max(currentUserId, targetUserId);

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
            const convId = existing.rows[0].id;
            // Reactive la conversation si elle etait masquee
            await pool.query(
                `INSERT INTO conversation_settings (conversation_id, user_id, is_hidden)
                 VALUES ($1, $2, FALSE)
                 ON CONFLICT (conversation_id, user_id) DO UPDATE SET is_hidden = FALSE`,
                [convId, currentUserId]
            );
            return res.json({ conversation: existing.rows[0], alreadyExists: true });
        }

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

// Supprimer (masquer) une conversation du compte de l'utilisateur
router.delete('/:id', authMiddleware, async (req, res) => {
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
            return res.status(403).json({ error: 'Acces refuse.' });
        }

        await pool.query(
            `INSERT INTO conversation_settings (conversation_id, user_id, is_hidden)
             VALUES ($1, $2, TRUE)
             ON CONFLICT (conversation_id, user_id) DO UPDATE SET is_hidden = TRUE`,
            [convId, userId]
        );

        res.json({ message: 'Conversation supprimee de votre compte.' });
    } catch (err) {
        console.error('Erreur suppression conversation :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Definir ou supprimer le mot de passe d'une conversation
router.put('/:id/password', authMiddleware, async (req, res) => {
    const convId = parseInt(req.params.id);
    const userId = req.user.userId;
    const { password } = req.body;

    if (isNaN(convId)) {
        return res.status(400).json({ error: 'ID de conversation invalide.' });
    }

    try {
        const check = await pool.query(
            'SELECT id FROM conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
            [convId, userId]
        );
        if (check.rows.length === 0) {
            return res.status(403).json({ error: 'Acces refuse.' });
        }

        let hash = null;
        if (password && typeof password === 'string' && password.trim().length > 0) {
            if (password.length < 4 || password.length > 128) {
                return res.status(400).json({ error: 'Le mot de passe doit contenir entre 4 et 128 caracteres.' });
            }
            hash = await bcrypt.hash(password, 10);
        }

        await pool.query(
            `INSERT INTO conversation_settings (conversation_id, user_id, password_hash)
             VALUES ($1, $2, $3)
             ON CONFLICT (conversation_id, user_id) DO UPDATE SET password_hash = $3`,
            [convId, userId, hash]
        );

        const message = hash ? 'Mot de passe defini avec succes.' : 'Mot de passe supprime avec succes.';
        res.json({ message, hasPassword: !!hash });
    } catch (err) {
        console.error('Erreur mot de passe conversation :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Deverrouiller une conversation protegee par mot de passe
router.post('/:id/unlock', authMiddleware, async (req, res) => {
    const convId = parseInt(req.params.id);
    const userId = req.user.userId;
    const { password } = req.body;

    if (isNaN(convId)) {
        return res.status(400).json({ error: 'ID de conversation invalide.' });
    }

    if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: 'Mot de passe requis.' });
    }

    try {
        const result = await pool.query(
            'SELECT password_hash FROM conversation_settings WHERE conversation_id = $1 AND user_id = $2',
            [convId, userId]
        );

        if (result.rows.length === 0 || !result.rows[0].password_hash) {
            return res.json({ unlocked: true });
        }

        const valid = await bcrypt.compare(password, result.rows[0].password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Mot de passe incorrect.' });
        }

        res.json({ unlocked: true });
    } catch (err) {
        console.error('Erreur deverrouillage conversation :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Messages d'une conversation (verifie l'appartenance et le verrouillage par mot de passe)
router.get('/:id/messages', authMiddleware, async (req, res) => {
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

        // Verifie si la conversation est protegee par mot de passe cote utilisateur
        const setting = await pool.query(
            'SELECT password_hash FROM conversation_settings WHERE conversation_id = $1 AND user_id = $2',
            [convId, userId]
        );

        if (setting.rows.length > 0 && setting.rows[0].password_hash) {
            const unlockHeader = req.headers['x-conversation-password'];
            if (!unlockHeader) {
                return res.status(423).json({ error: 'Conversation verrouillee par un mot de passe.', locked: true });
            }
            const valid = await bcrypt.compare(unlockHeader, setting.rows[0].password_hash);
            if (!valid) {
                return res.status(423).json({ error: 'Mot de passe de conversation incorrect.', locked: true });
            }
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

// Envoyer un message (limite a 20 messages par 10s, max 20000 chars pour supporter les payloads chiffres)
router.post('/:id/messages', authMiddleware, rateLimiter(10000, 20), async (req, res) => {
    const convId = parseInt(req.params.id);
    const userId = req.user.userId;
    const { content } = req.body;

    if (isNaN(convId)) {
        return res.status(400).json({ error: 'ID de conversation invalide.' });
    }

    if (!content || typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: 'Message vide.' });
    }

    if (content.length > 20000) {
        return res.status(400).json({ error: 'Le message est trop long.' });
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

        // Reveille la conversation pour l'autre participant si elle etait masquee
        const otherUserId = conv.user1_id === userId ? conv.user2_id : conv.user1_id;
        await pool.query(
            `INSERT INTO conversation_settings (conversation_id, user_id, is_hidden)
             VALUES ($1, $2, FALSE)
             ON CONFLICT (conversation_id, user_id) DO UPDATE SET is_hidden = FALSE`,
            [convId, otherUserId]
        );

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

module.exports = router;

