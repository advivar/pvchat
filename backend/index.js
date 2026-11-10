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
const isAllowedOrigin = (origin) => {
    if (!origin || origin === 'null') return true;
    if (process.env.CORS_ORIGIN) {
        const allowed = process.env.CORS_ORIGIN.split(',').map(s => s.trim());
        if (allowed.includes(origin)) return true;
    }
    // Autoriser tout port local de developpement (Docker 8080/9080, LiveServer 5500, direct 3000, etc.)
    const localRegex = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
    return localRegex.test(origin);
};

app.use(cors({
    origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Origine bloquee : ${origin}`);
            callback(new Error('Non autorise par la politique CORS'));
        }
    },
    credentials: true
}));

// Montage des routes modulaires
app.use('/', authRoutes);
app.use('/users', userRoutes);
app.use('/conversations', conversationRoutes);

// Gestionnaire d'erreur global (empeche les fuites de stack trace)
app.use((err, req, res, next) => {
    console.error('[ERREUR]', err.message || err);
    res.status(err.status || 500).json({
        error: err.message || 'Une erreur interne est survenue.'
    });
});

// Creation du serveur HTTP et attachement du WebSocket
const server = http.createServer(app);
initWebSocket(server);

// Lancement du serveur et initialisation de la base de donnees
server.listen(PORT, async () => {
    await initDb();
    console.log(`Serveur PVCHAT ecoute sur port ${PORT}`);
});
