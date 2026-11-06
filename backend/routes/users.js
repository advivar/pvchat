// Routes utilisateurs : cles publiques E2EE et recherche d'utilisateurs

const express = require('express');
const { pool } = require('../db/pool');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Sauvegarder la cle publique E2EE dans la base
router.put('/me/public-key', authMiddleware, async (req, res) => {
    const { public_key } = req.body;
    const userId = req.user.userId;

    if (!public_key) {
        return res.status(400).json({ error: 'Cle publique manquante.' });
    }

    try {
        await pool.query(
            'UPDATE users SET public_key = $1 WHERE id = $2',
            [public_key, userId]
        );
        res.json({ message: 'Cle publique mise a jour avec succes' });
    } catch (err) {
        console.error('Erreur MAJ cle publique :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Recherche des utilisateurs pour autocompletion (place avant /:id pour eviter les collisions)
router.get('/search', authMiddleware, async (req, res) => {
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

// Recuperer la cle publique E2EE d'un destinataire
router.get('/:id/public-key', authMiddleware, async (req, res) => {
    const targetUserId = parseInt(req.params.id);

    if (isNaN(targetUserId)) {
        return res.status(400).json({ error: 'ID utilisateur invalide.' });
    }

    try {
        const result = await pool.query(
            'SELECT public_key FROM users WHERE id = $1',
            [targetUserId]
        );

        if (result.rows.length === 0 || !result.rows[0].public_key) {
            return res.status(404).json({ error: 'Cle publique non trouvee' });
        }

        res.json({ public_key: result.rows[0].public_key });
    } catch (err) {
        console.error('Erreur recup cle publique :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

module.exports = router;

