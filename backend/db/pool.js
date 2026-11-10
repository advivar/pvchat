// Gestion du pool de connexions PostgreSQL et initialisation des tables

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// Initialisation des tables si elles n'existent pas
async function initDb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                public_key TEXT,
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

            CREATE TABLE IF NOT EXISTS conversation_settings (
                id SERIAL PRIMARY KEY,
                conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                is_hidden BOOLEAN DEFAULT FALSE,
                password_hash VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT unique_conv_user_setting UNIQUE (conversation_id, user_id)
            );

            ALTER TABLE users ADD COLUMN IF NOT EXISTS public_key TEXT;
            ALTER TABLE conversations DROP COLUMN IF EXISTS password_hash;
        `);
        console.log('Base de donnees initialisee avec succes.');
    } catch (err) {
        console.error('Erreur initialisation BDD :', err);
    }
}

module.exports = {
    pool,
    initDb
};

