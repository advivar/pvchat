const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Configuration de la connexion PostgreSQL
const pool = new Pool({
    user: 'postgres',
    host: 'localhost', // À adapter avec la configuration Docker d'Augustin
    database: 'pvchat_db',
    password: 'mot_de_passe_securise',
    port: 5432,
});

const SECRET_KEY = 'cle_secrete_temporaire_pour_jwt'; // À mettre dans un fichier .env plus tard

// --- API REST : INSCRIPTION ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
            [username, hashedPassword]
        );
        res.status(201).json({ message: 'Utilisateur créé', user: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà.' });
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// --- API REST : CONNEXION ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Identifiants incorrects.' });
        }

        const token = jwt.sign({ userId: user.id, username: user.username }, SECRET_KEY, { expiresIn: '24h' });
        res.json({ message: 'Connexion réussie', token });
    } catch (err) {
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// --- SERVEUR WEBSOCKETS (TEMPS RÉEL) ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('Nouvel utilisateur connecté via WebSocket');

    ws.on('message', (message) => {
        console.log(`Message reçu : ${message}`);
        // Ici, on diffusera plus tard les messages chiffrés aux autres clients
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message.toString());
            }
        });
    });

    ws.on('close', () => {
        console.log('Utilisateur déconnecté');
    });
});

// Lancement du serveur
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur PVCHAT en écoute sur le port ${PORT}`);
});
