// Point d'entree principal du serveur backend PVCHAT

const express = require('express');
const http = require('http');
const cors = require('cors');

const { PORT } = require('./config');
const { initDb } = require('./db/pool');
const { initWebSocket } = require('./ws/socket');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const conversationRoutes = require('./routes/conversations');

const app = express();

// Masque le header X-Powered-By pour ne pas exposer Express
app.disable('x-powered-by');

// Fait confiance au reverse proxy Nginx pour recuperer la vraie IP client
app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));

// Configuration CORS securisee
const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
    : ['http://localhost:9080', 'http://127.0.0.1:9080'];

app.use(cors({
    origin: (origin, callback) => {
        // Autoriser les requetes sans origin (reverse-proxy Nginx local, curl, tests)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Non autorise par la politique CORS'));
        }
    },
    credentials: true
}));

// Montage des routes modulaires
app.use('/', authRoutes);
app.use('/users', userRoutes);
app.use('/conversations', conversationRoutes);

// Creation du serveur HTTP et attachement du WebSocket
const server = http.createServer(app);
initWebSocket(server);

// Lancement du serveur et initialisation de la base de donnees
server.listen(PORT, async () => {
    await initDb();
    console.log(`Serveur PVCHAT ecoute sur port ${PORT}`);
});
