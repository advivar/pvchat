// Accès aux données des conversations et paramètres utilisateur associés

const { pool } = require('../pool');

// Liste des conversations visibles pour l'utilisateur
async function getUserConversations(userId) {
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
    return result.rows;
}

// Recherche une conversation existante entre deux utilisateurs
async function findBetween(currentUserId, u1, u2) {
    const query = `
        SELECT c.id,
               CASE WHEN c.user1_id = $1 THEN u2.id ELSE u1.id END AS other_user_id,
               CASE WHEN c.user1_id = $1 THEN u2.username ELSE u1.username END AS other_username,
               CASE WHEN cs.password_hash IS NOT NULL THEN TRUE ELSE FALSE END AS has_password
        FROM conversations c
        JOIN users u1 ON c.user1_id = u1.id
        JOIN users u2 ON c.user2_id = u2.id
        LEFT JOIN conversation_settings cs ON cs.conversation_id = c.id AND cs.user_id = $1
        WHERE c.user1_id = $2 AND c.user2_id = $3
    `;
    const result = await pool.query(query, [currentUserId, u1, u2]);
    return result.rows[0] || null;
}

// Crée une nouvelle conversation
async function create(u1, u2) {
    const result = await pool.query(
        'INSERT INTO conversations (user1_id, user2_id) VALUES ($1, $2) RETURNING id',
        [u1, u2]
    );
    return result.rows[0].id;
}

// Modifie la visibilité d'une conversation pour un utilisateur (masquage/réactivation)
async function setHidden(convId, userId, isHidden) {
    await pool.query(
        `INSERT INTO conversation_settings (conversation_id, user_id, is_hidden)
         VALUES ($1, $2, $3)
         ON CONFLICT (conversation_id, user_id) DO UPDATE SET is_hidden = $3`,
        [convId, userId, isHidden]
    );
}

// Récupère les paramètres personnalisés d'une conversation pour un utilisateur
async function getSettings(convId, userId) {
    const result = await pool.query(
        'SELECT password_hash, is_hidden FROM conversation_settings WHERE conversation_id = $1 AND user_id = $2',
        [convId, userId]
    );
    return result.rows[0] || null;
}

// Met à jour le mot de passe d'une conversation pour un utilisateur
async function setPassword(convId, userId, passwordHash) {
    await pool.query(
        `INSERT INTO conversation_settings (conversation_id, user_id, password_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (conversation_id, user_id) DO UPDATE SET password_hash = $3`,
        [convId, userId, passwordHash]
    );
}

module.exports = {
    getUserConversations,
    findBetween,
    create,
    setHidden,
    getSettings,
    setPassword
};

