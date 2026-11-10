// Routes de gestion des conversations et des messages

const express = require('express');
const bcrypt = require('bcrypt');

const authMiddleware = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');
const { requireConversationParticipant } = require('../middleware/conversation');
const { broadcastToConversation } = require('../ws/socket');

const conversationRepo = require('../db/repositories/conversationRepository');
const messageRepo = require('../db/repositories/messageRepository');
const userRepo = require('../db/repositories/userRepository');

const router = express.Router();

// Liste des conversations de l'utilisateur (exclut les conversations masquees)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const conversations = await conversationRepo.getUserConversations(req.user.userId);
        res.json(conversations);
    } catch (err) {
        console.error('Erreur recup conversations :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Creer ou recuperer une conversation existante (reactive si masquee)
router.post('/', authMiddleware, async (req, res) => {
    const currentUserId = req.user.userId;
    const targetUserId = parseInt(req.body.targetUserId);

    if (isNaN(targetUserId)) {
        return res.status(400).json({ error: 'Destinataire invalide.' });
    }

    if (currentUserId === targetUserId) {
        return res.status(400).json({ error: 'Impossible de creer un chat avec vous-meme.' });
    }

    try {
        const u1 = Math.min(currentUserId, targetUserId);
        const u2 = Math.max(currentUserId, targetUserId);

        const existing = await conversationRepo.findBetween(currentUserId, u1, u2);
        if (existing) {
            // Reactive la conversation si elle etait masquee
            await conversationRepo.setHidden(existing.id, currentUserId, false);
            return res.json({ conversation: existing, alreadyExists: true });
        }

        const target = await userRepo.findById(targetUserId);
        if (!target) {
            return res.status(404).json({ error: 'Utilisateur introuvable.' });
        }

        const newId = await conversationRepo.create(u1, u2);

        res.status(201).json({
            conversation: {
                id: newId,
                other_user_id: target.id,
                other_username: target.username,
                last_message: null,
                has_password: false
            },
            alreadyExists: false
        });
    } catch (err) {
        console.error('Erreur creation conversation :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Supprimer (masquer) une conversation du compte de l'utilisateur
router.delete('/:id', authMiddleware, requireConversationParticipant, async (req, res) => {
    try {
        await conversationRepo.setHidden(req.convId, req.user.userId, true);
        res.json({ message: 'Conversation supprimee de votre compte.' });
    } catch (err) {
        console.error('Erreur suppression conversation :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Definir, modifier ou supprimer le mot de passe d'une conversation (anti brute-force 10 req/min)
router.put('/:id/password', authMiddleware, rateLimiter(60000, 10), requireConversationParticipant, async (req, res) => {
    const userId = req.user.userId;
    const { password, currentPassword } = req.body;

    try {
        const settings = await conversationRepo.getSettings(req.convId, userId);
        const existingHash = settings ? settings.password_hash : null;

        // Si la discussion est deja protegee, verification obligatoire du mot de passe actuel
        if (existingHash) {
            if (!currentPassword || typeof currentPassword !== 'string' || !currentPassword.trim()) {
                return res.status(400).json({
                    error: 'Le mot de passe actuel de la discussion est requis pour modifier ou supprimer la protection.'
                });
            }
            const valid = await bcrypt.compare(currentPassword.trim(), existingHash);
            if (!valid) {
                return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
            }
        }

        let hash = null;
        if (password && typeof password === 'string' && password.trim().length > 0) {
            if (password.length < 4 || password.length > 128) {
                return res.status(400).json({ error: 'Le mot de passe doit contenir entre 4 et 128 caracteres.' });
            }
            hash = await bcrypt.hash(password, 10);
        }

        await conversationRepo.setPassword(req.convId, userId, hash);

        // Diffuse uniquement aux sessions de l'utilisateur courant (confidentialité stricte)
        broadcastToConversation([userId], {
            type: 'conversation_password_changed',
            conversation_id: req.convId,
            has_password: !!hash
        });

        const message = hash ? 'Mot de passe defini avec succes.' : 'Protection par mot de passe supprimee avec succes.';
        res.json({ message, hasPassword: !!hash });
    } catch (err) {
        console.error('Erreur mot de passe conversation :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Deverrouiller une conversation protegee par mot de passe (anti brute-force 30 req/min)
router.post('/:id/unlock', authMiddleware, rateLimiter(60000, 30), requireConversationParticipant, async (req, res) => {
    const { password } = req.body;

    if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: 'Mot de passe requis.' });
    }

    try {
        const settings = await conversationRepo.getSettings(req.convId, req.user.userId);
        const hash = settings ? settings.password_hash : null;

        if (!hash) {
            return res.json({ unlocked: true });
        }

        const valid = await bcrypt.compare(password, hash);
        if (!valid) {
            return res.status(401).json({ error: 'Mot de passe incorrect.' });
        }

        res.json({ unlocked: true });
    } catch (err) {
        console.error('Erreur deverrouillage conversation :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Messages d'une conversation
router.get('/:id/messages', authMiddleware, requireConversationParticipant, async (req, res) => {
    try {
        const msgs = await messageRepo.getByConversationId(req.convId);
        res.json(msgs);
    } catch (err) {
        console.error('Erreur chargement messages :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

// Envoyer un message (limite a 20 msgs / 10s, max 20000 chars pour supporter les payloads chiffres E2EE)
router.post('/:id/messages', authMiddleware, rateLimiter(10000, 20), requireConversationParticipant, async (req, res) => {
    const userId = req.user.userId;
    const { content } = req.body;

    if (!content || typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: 'Message vide.' });
    }

    if (content.length > 20000) {
        return res.status(400).json({ error: 'Le message est trop long.' });
    }

    try {
        const conv = req.conversation;

        // Reveille la conversation pour l'autre participant si elle etait masquee
        const otherUserId = conv.user1_id === userId ? conv.user2_id : conv.user1_id;
        await conversationRepo.setHidden(req.convId, otherUserId, false);

        const newMsg = await messageRepo.createMessage(req.convId, userId, content.trim());
        newMsg.sender_name = req.user.username;

        // Diffusion websocket UNIQUEMENT aux deux participants autorises
        broadcastToConversation([conv.user1_id, conv.user2_id], {
            type: 'new_message',
            message: newMsg
        });

        res.status(201).json(newMsg);
    } catch (err) {
        console.error('Erreur envoi message :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

module.exports = router;
