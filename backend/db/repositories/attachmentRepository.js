// Accès aux données des pièces jointes

const { pool } = require('../pool');

async function createAttachment({ id, conversationId, uploaderId, originalName, fileSize, mimeType, storagePath }) {
    const result = await pool.query(
        `INSERT INTO attachments (id, conversation_id, uploader_id, original_name, file_size, mime_type, storage_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, conversation_id, message_id, uploader_id, original_name, file_size, mime_type, storage_path, created_at`,
        [id, conversationId, uploaderId, originalName, fileSize, mimeType, storagePath]
    );
    return result.rows[0];
}

async function getById(id) {
    const result = await pool.query(
        `SELECT id, conversation_id, message_id, uploader_id, original_name, file_size, mime_type, storage_path, created_at
         FROM attachments
         WHERE id = $1`,
        [id]
    );
    return result.rows[0] || null;
}

async function linkToMessage(attachmentId, messageId) {
    const result = await pool.query(
        `UPDATE attachments
         SET message_id = $2
         WHERE id = $1
         RETURNING id, conversation_id, message_id, original_name, file_size, mime_type`,
        [attachmentId, messageId]
    );
    return result.rows[0] || null;
}

async function deleteAttachment(id) {
    const result = await pool.query(
        `DELETE FROM attachments WHERE id = $1 RETURNING id, storage_path`,
        [id]
    );
    return result.rows[0] || null;
}

async function getOrphanedOlderThan(hours = 2) {
    const result = await pool.query(
        `SELECT id, storage_path
         FROM attachments
         WHERE message_id IS NULL AND created_at < NOW() - INTERVAL '1 hour' * $1`,
        [hours]
    );
    return result.rows;
}

async function getExpiredOlderThan(days = 14) {
    const result = await pool.query(
        `SELECT id, storage_path
         FROM attachments
         WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
        [days]
    );
    return result.rows;
}

async function getTotalStorageUsed() {
    const result = await pool.query(
        `SELECT COALESCE(SUM(file_size), 0) AS total_bytes FROM attachments`
    );
    return parseInt(result.rows[0].total_bytes, 10) || 0;
}

module.exports = {
    createAttachment,
    getById,
    linkToMessage,
    deleteAttachment,
    getOrphanedOlderThan,
    getExpiredOlderThan,
    getTotalStorageUsed
};

