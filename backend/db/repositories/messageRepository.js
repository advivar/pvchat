// Accès aux données des messages

const { pool } = require('../pool');

// Récupère l'historique des messages ordonné chronologiquement (avec les pièces jointes éventuelles)
async function getByConversationId(convId) {
    const result = await pool.query(
        `SELECT m.id, m.conversation_id, m.sender_id, u.username AS sender_name, m.content, m.created_at,
                m.attachment_id,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', a.id,
                            'original_name', a.original_name,
                            'file_size', a.file_size,
                            'mime_type', a.mime_type
                        ) ORDER BY a.created_at ASC
                    ) FILTER (WHERE a.id IS NOT NULL),
                    '[]'
                ) AS attachments
         FROM messages m
         JOIN users u ON m.sender_id = u.id
         LEFT JOIN attachments a ON a.message_id = m.id OR a.id = m.attachment_id
         WHERE m.conversation_id = $1
         GROUP BY m.id, u.username
         ORDER BY m.created_at ASC`,
        [convId]
    );

    // Compatibilité ascendante/descendante pour les propriétés directes
    result.rows.forEach(row => {
        const atts = Array.isArray(row.attachments) ? row.attachments : [];
        if (atts.length > 0) {
            row.attachment_id = atts[0].id;
            row.attachment_name = atts[0].original_name;
            row.attachment_size = parseInt(atts[0].file_size, 10);
            row.attachment_mime = atts[0].mime_type;
        }
    });

    return result.rows;
}

// Insère un nouveau message dans une conversation (avec ou sans pièce jointe)
async function createMessage(convId, senderId, content, attachmentId = null) {
    const result = await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, content, attachment_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, conversation_id, sender_id, content, attachment_id, created_at`,
        [convId, senderId, content, attachmentId]
    );
    return result.rows[0];
}

module.exports = {
    getByConversationId,
    createMessage
};

