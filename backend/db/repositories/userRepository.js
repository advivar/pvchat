// Accès aux données de la table users

const { pool } = require('../pool');

async function createUser(username, passwordHash) {
    const result = await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
        [username.trim(), passwordHash]
    );
    return result.rows[0];
}

async function findByUsername(username) {
    const result = await pool.query(
        'SELECT * FROM users WHERE username = $1',
        [username.trim()]
    );
    return result.rows[0] || null;
}

async function findById(id) {
    const result = await pool.query(
        'SELECT id, username, public_key, created_at FROM users WHERE id = $1',
        [id]
    );
    return result.rows[0] || null;
}

async function getPasswordHash(userId) {
    const result = await pool.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [userId]
    );
    return result.rows[0] ? result.rows[0].password_hash : null;
}

async function updatePublicKey(userId, publicKey) {
    await pool.query(
        'UPDATE users SET public_key = $1 WHERE id = $2',
        [publicKey, userId]
    );
}

async function getPublicKey(userId) {
    const result = await pool.query(
        'SELECT public_key FROM users WHERE id = $1',
        [userId]
    );
    return result.rows[0] ? result.rows[0].public_key : null;
}

async function searchUsers(query, excludeUserId) {
    const result = await pool.query(
        'SELECT id, username FROM users WHERE username ILIKE $1 AND id != $2 ORDER BY username ASC LIMIT 10',
        [`%${query}%`, excludeUserId]
    );
    return result.rows;
}

module.exports = {
    createUser,
    findByUsername,
    findById,
    getPasswordHash,
    updatePublicKey,
    getPublicKey,
    searchUsers
};

