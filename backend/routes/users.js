// Routes utilisateurs : cles publiques E2EE et recherche d'utilisateurs

const express = require('express');

const authMiddleware = require('../middleware/auth');
const userRepo = require('../db/repositories/userRepository');

const router = express.Router();

// Sauvegarder la cle publique E2EE dans la base
router.put('/me/public-key', authMiddleware, async (req, res) => {
    const { public_key } = req.body;
    const userId = req.user.userId;

    if (!public_key) {
        return res.status(400).json({ error: 'Cle publique manquante.' });
    }

    try {
        await userRepo.updatePublicKey(userId, public_key);
        res.json({ message: 'Cle publique mise a jour avec succes' });
    } catch (err) {
        console.error('Erreur MAJ cle publique :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Recherche des utilisateurs pour autocompletion
router.get('/search', authMiddleware, async (req, res) => {
    const rawQuery = String(req.query.q || '').trim().slice(0, 50);
    if (!rawQuery) return res.json([]);

    try {
        const users = await userRepo.searchUsers(rawQuery, req.user.userId);
        res.json(users);
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
        const publicKey = await userRepo.getPublicKey(targetUserId);

        if (!publicKey) {
            return res.status(404).json({ error: 'Cle publique non trouvee' });
        }

        res.json({ public_key: publicKey });
    } catch (err) {
        console.error('Erreur recup cle publique :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

module.exports = router;
