// Rate limiting en memoire (protection anti brute-force et anti spam)
// Chaque instance de middleware possede son propre identifiant d'isolation

let limiterInstanceCounter = 0;
const rateLimits = new Map();

function rateLimiter(windowMs, maxRequests) {
    const instanceId = ++limiterInstanceCounter;

    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        // Isolation par instance de route, par IP et par compte utilisateur si authentifie
        const userId = req.user && req.user.userId ? req.user.userId : 'anon';
        const key = `${instanceId}:${ip}:${userId}`;
        const now = Date.now();

        const record = rateLimits.get(key) || { count: 0, resetTime: now + windowMs };

        if (now > record.resetTime) {
            record.count = 1;
            record.resetTime = now + windowMs;
        } else {
            record.count += 1;
        }

        rateLimits.set(key, record);

        if (record.count > maxRequests) {
            return res.status(429).json({ error: 'Trop de requêtes. Veuillez patienter un moment.' });
        }

        next();
    };
}

// Nettoyage periodique des entrees expirees (toutes les minutes)
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimits.entries()) {
        if (now > value.resetTime) {
            rateLimits.delete(key);
        }
    }
}, 60000);

module.exports = rateLimiter;
