// Verification du token JWT

const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('../config');

function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Non connecte' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token manquant' });

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Session expiree ou invalide' });
        req.user = decoded;
        next();
    });
}

module.exports = authMiddleware;

