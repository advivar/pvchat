// Routes d'authentification : register, login, me, verify-password

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { SECRET_KEY, USERNAME_REGEX } = require('../config');
const rateLimiter = require('../middleware/rateLimiter');
const authMiddleware = require('../middleware/auth');
const userRepo = require('../db/repositories/userRepository');

const router = express.Router();

// Inscription (limite a 5 essais par minute par IP)
router.post('/register', rateLimiter(60000, 5), async (req, res) => {
    const { username, password } = req.body;

    if (!username || typeof username !== 'string' || !USERNAME_REGEX.test(username.trim())) {
        return res.status(400).json({
            error: 'Le nom d\'utilisateur doit contenir entre 3 et 30 caractères (lettres, chiffres, tirets, points).'
        });
    }

    if (!password || typeof password !== 'string' || password.length < 6 || password.length > 128) {
        return res.status(400).json({
            error: 'Le mot de passe doit contenir entre 6 et 128 caractères.'
        });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await userRepo.createUser(username, hashedPassword);
        res.status(201).json({ message: 'Compte cree', user });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Ce nom d\'utilisateur existe deja.' });
        }
        console.error('Erreur inscription :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Connexion (limite a 10 essais par minute par IP pour contrer le brute-force)
router.post('/login', rateLimiter(60000, 10), async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Identifiants incomplets.' });
    }

    try {
        const user = await userRepo.findByUsername(username);

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Identifiants incorrects.' });
        }

        const token = jwt.sign(
            { userId: user.id, username: user.username },
            SECRET_KEY,
            { expiresIn: '24h' }
        );

        res.json({
            message: 'Connexion reussie',
            token,
            user: { id: user.id, username: user.username }
        });
    } catch (err) {
        console.error('Erreur connexion :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Recupere l'utilisateur actuel
router.get('/me', authMiddleware, (req, res) => {
    res.json({
        user: {
            id: req.user.userId,
            userId: req.user.userId,
            username: req.user.username
        }
    });
});

// Verification du mot de passe du compte (anti brute-force 5 essais/min)
router.post('/verify-password', authMiddleware, rateLimiter(60000, 5), async (req, res) => {
    const { password } = req.body;
    const userId = req.user.userId;

    if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: 'Mot de passe requis.' });
    }

    try {
        const hash = await userRepo.getPasswordHash(userId);
        if (!hash) {
            return res.status(404).json({ error: 'Utilisateur introuvable.' });
        }

        const valid = await bcrypt.compare(password, hash);
        if (!valid) {
            return res.status(401).json({ error: 'Mot de passe du compte incorrect.' });
        }

        res.json({ valid: true });
    } catch (err) {
        console.error('Erreur verification mot de passe compte :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

module.exports = router;
