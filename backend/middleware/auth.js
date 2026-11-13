// Verification du token JWT

const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('../config');

function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }

    if (!token) return res.status(401).json({ error: 'Non connecte ou token manquant' });

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Session expiree ou invalide' });
        req.user = decoded;
        next();
    });
}

module.exports = authMiddleware;

