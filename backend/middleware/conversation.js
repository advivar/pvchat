// Middleware de vérification d'accès à une conversation

const { pool } = require('../db/pool');

async function requireConversationParticipant(req, res, next) {
    const convId = parseInt(req.params.id);
    const userId = req.user && req.user.userId;

    if (isNaN(convId)) {
        return res.status(400).json({ error: 'ID de conversation invalide.' });
    }

    if (!userId) {
        return res.status(401).json({ error: 'Non authentifié.' });
    }

    try {
        const result = await pool.query(
            'SELECT id, user1_id, user2_id FROM conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
            [convId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(403).json({ error: 'Accès refusé à cette conversation.' });
        }

        req.convId = convId;
        req.conversation = result.rows[0];
        next();
    } catch (err) {
        console.error('Erreur vérification appartenance conversation :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
}

module.exports = {
    requireConversationParticipant
};

