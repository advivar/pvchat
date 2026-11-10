// Accès aux données des messages

const { pool } = require('../pool');

// Récupère l'historique des messages ordonné chronologiquement
async function getByConversationId(convId) {
    const result = await pool.query(
        `SELECT m.id, m.conversation_id, m.sender_id, u.username AS sender_name, m.content, m.created_at
         FROM messages m
         JOIN users u ON m.sender_id = u.id
         WHERE m.conversation_id = $1
         ORDER BY m.created_at ASC`,
        [convId]
    );
    return result.rows;
}

// Insère un nouveau message dans une conversation
async function createMessage(convId, senderId, content) {
    const result = await pool.query(
        'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, $3) RETURNING id, conversation_id, sender_id, content, created_at',
        [convId, senderId, content]
    );
    return result.rows[0];
}

module.exports = {
    getByConversationId,
    createMessage
};

