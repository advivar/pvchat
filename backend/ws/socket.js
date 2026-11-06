// WebSocket temps reel securise avec authentification JWT

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('../config');

let wss = null;

function initWebSocket(server) {
    wss = new WebSocket.Server({ server });

    wss.on('connection', (ws, req) => {
        try {
            const url = new URL(req.url, 'http://localhost');
            const token = url.searchParams.get('token');

            if (!token) {
                ws.close(4001, 'Token manquant');
                return;
            }

            jwt.verify(token, SECRET_KEY, (err, decoded) => {
                if (err) {
                    ws.close(4002, 'Token invalide');
                    return;
                }
                ws.userId = decoded.userId;
                ws.username = decoded.username;
            });
        } catch (e) {
            ws.close(4000, 'Erreur de connexion');
        }

        ws.on('error', () => {});
    });

    return wss;
}

// Diffuse uniquement aux destinataires autorises (confidentialite stricte)
function broadcastToConversation(participantIds, data) {
    if (!wss) return;
    const payload = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && participantIds.includes(client.userId)) {
            client.send(payload);
        }
    });
}

module.exports = {
    initWebSocket,
    broadcastToConversation
};

