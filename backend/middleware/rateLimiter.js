// Rate limiting simple en memoire (protection anti brute-force et anti spam)

const rateLimits = new Map();

function rateLimiter(windowMs, maxRequests) {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const now = Date.now();
        const record = rateLimits.get(ip) || { count: 0, resetTime: now + windowMs };

        if (now > record.resetTime) {
            record.count = 1;
            record.resetTime = now + windowMs;
        } else {
            record.count += 1;
        }

        rateLimits.set(ip, record);

        if (record.count > maxRequests) {
            return res.status(429).json({ error: 'Trop de requêtes. Veuillez patienter un moment.' });
        }

        next();
    };
}

// Nettoyage de la memoire du rate limiter chaque minute
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimits.entries()) {
        if (now > value.resetTime) {
            rateLimits.delete(key);
        }
    }
}, 60000);

module.exports = rateLimiter;

