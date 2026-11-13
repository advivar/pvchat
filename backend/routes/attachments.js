// Routes pour l'envoi, le téléchargement et la gestion des pièces jointes

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const busboy = require('busboy');

const authMiddleware = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');
const { pool } = require('../db/pool');
const { MAX_FILE_SIZE, UPLOAD_DIR } = require('../config');
const attachmentRepo = require('../db/repositories/attachmentRepository');
const {
    ensureUploadDir,
    hasStorageCapacity,
    safeDeleteFile
} = require('../services/storageService');

const router = express.Router();

// Nettoie un nom de fichier pour éviter les injections ou traversées de répertoire
function sanitizeFilename(filename) {
    if (!filename || typeof filename !== 'string') return 'attachment.bin';
    const base = path.basename(filename).replace(/[\/\?<>\\:\*\|":]/g, '_');
    return base.substring(0, 200) || 'attachment.bin';
}

// Déduit le MIME type exact si non fourni ou générique
function getMimeType(filename, providedMime) {
    if (providedMime && providedMime !== 'application/octet-stream' && providedMime.trim().length > 0) {
        return providedMime.toLowerCase().trim();
    }
    const ext = path.extname(filename || '').toLowerCase().replace('.', '');
    const map = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'bmp': 'image/bmp',
        'svg': 'image/svg+xml',
        'avif': 'image/avif',
        'pdf': 'application/pdf',
        'mp4': 'video/mp4',
        'mp3': 'audio/mpeg',
        'zip': 'application/zip'
    };
    return map[ext] || providedMime || 'application/octet-stream';
}

function isImageFile(mimeType, filename) {
    const mime = (mimeType || '').toLowerCase().trim();
    if (mime.startsWith('image/')) return true;
    const ext = path.extname(filename || '').toLowerCase().replace('.', '');
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext);
}

// 1. Upload d'une pièce jointe (max 512 Mo streamé directement sur disque)
// Limité à 15 uploads / 10 minutes par IP/utilisateur pour prévenir le déni de service
router.post('/upload', authMiddleware, rateLimiter(600000, 15), async (req, res) => {
    const userId = req.user.userId;

    // Vérification initiale de la capacité totale
    const canAccept = await hasStorageCapacity(1024 * 1024);
    if (!canAccept) {
        return res.status(507).json({ error: 'Espace de stockage du serveur saturé. Impossible d\'accepter de nouveaux fichiers.' });
    }

    let bb;
    try {
        bb = busboy({
            headers: req.headers,
            limits: {
                files: 1,
                fileSize: MAX_FILE_SIZE
            }
        });
    } catch (err) {
        return res.status(400).json({ error: 'En-têtes de requête multipart invalides.' });
    }

    ensureUploadDir();

    let convId = parseInt(req.query.conversation_id, 10);
    let fileHandled = false;
    let fileLimitReached = false;
    let uploadAborted = false;
    let createdFilePath = null;
    let originalName = 'attachment.bin';
    let mimeType = 'application/octet-stream';
    let attachmentId = crypto.randomUUID();
    let bytesWritten = 0;
    let writeStream = null;

    // Récupération des champs textes du formulaire multipart
    bb.on('field', (name, val) => {
        if (name === 'conversation_id' && isNaN(convId)) {
            convId = parseInt(val, 10);
        }
    });

    bb.on('file', (name, fileStream, info) => {
        fileHandled = true;
        originalName = sanitizeFilename(info.filename);
        mimeType = getMimeType(originalName, info.mimeType);

        const safeDiskName = `${attachmentId}.bin`;
        createdFilePath = path.join(UPLOAD_DIR, safeDiskName);
        writeStream = fs.createWriteStream(createdFilePath, { mode: 0o600 });

        fileStream.on('data', (data) => {
            bytesWritten += data.length;
        });

        fileStream.on('limit', () => {
            fileLimitReached = true;
            fileStream.resume(); // Vide le flux
            if (writeStream) writeStream.destroy();
            safeDeleteFile(createdFilePath);
        });

        fileStream.on('error', (err) => {
            console.error('[ATTACHMENT] Erreur lecture flux fichier :', err);
            uploadAborted = true;
            if (writeStream) writeStream.destroy();
            safeDeleteFile(createdFilePath);
        });

        writeStream.on('error', (err) => {
            console.error('[ATTACHMENT] Erreur écriture flux disque :', err);
            uploadAborted = true;
            safeDeleteFile(createdFilePath);
        });

        fileStream.pipe(writeStream);
    });

    req.on('aborted', () => {
        uploadAborted = true;
        if (writeStream) writeStream.destroy();
        safeDeleteFile(createdFilePath);
    });

    bb.on('close', async () => {
        if (fileLimitReached) {
            return res.status(413).json({
                error: 'Le fichier dépasse la taille maximale autorisée de 512 Mo.'
            });
        }

        if (uploadAborted || !fileHandled) {
            if (createdFilePath) safeDeleteFile(createdFilePath);
            return res.status(400).json({ error: 'Aucun fichier transmis ou transfert interrompu.' });
        }

        if (isNaN(convId)) {
            safeDeleteFile(createdFilePath);
            return res.status(400).json({ error: 'ID de conversation manquant ou invalide.' });
        }

        try {
            // Vérification que l'utilisateur est bien membre de la conversation
            const convCheck = await pool.query(
                'SELECT id FROM conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
                [convId, userId]
            );

            if (convCheck.rows.length === 0) {
                safeDeleteFile(createdFilePath);
                return res.status(403).json({ error: 'Accès non autorisé à cette conversation.' });
            }

            // Vérification du quota global avec la taille réelle écrite
            const capacityOk = await hasStorageCapacity(bytesWritten);
            if (!capacityOk) {
                safeDeleteFile(createdFilePath);
                return res.status(507).json({ error: 'Quota de stockage serveur dépassé.' });
            }

            const record = await attachmentRepo.createAttachment({
                id: attachmentId,
                conversationId: convId,
                uploaderId: userId,
                originalName,
                fileSize: bytesWritten,
                mimeType,
                storagePath: createdFilePath
            });

            res.status(201).json({
                id: record.id,
                conversation_id: record.conversation_id,
                original_name: record.original_name,
                file_size: parseInt(record.file_size, 10),
                mime_type: record.mime_type
            });
        } catch (err) {
            console.error('[ATTACHMENT] Erreur enregistrement BDD :', err);
            safeDeleteFile(createdFilePath);
            res.status(500).json({ error: 'Erreur lors de l\'enregistrement de la pièce jointe.' });
        }
    });

    req.pipe(bb);
});

// 2. Téléchargement ou prévisualisation sécurisée d'une pièce jointe
router.get('/:id/download', authMiddleware, async (req, res) => {
    const attachmentId = req.params.id;
    const userId = req.user.userId;

    try {
        const attachment = await attachmentRepo.getById(attachmentId);
        if (!attachment) {
            return res.status(404).json({ error: 'Pièce jointe introuvable.' });
        }

        // Vérification d'autorisation : l'utilisateur doit participer à la conversation
        const convCheck = await pool.query(
            'SELECT id FROM conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
            [attachment.conversation_id, userId]
        );

        if (convCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Accès refusé à cette pièce jointe.' });
        }

        const filePath = path.resolve(attachment.storage_path);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Fichier physique introuvable sur le serveur.' });
        }

        // Encodage conforme RFC 5987 pour les noms de fichiers contenant des accents ou espaces
        const safeOriginalName = attachment.original_name.replace(/"/g, '');
        const encodedName = encodeURIComponent(safeOriginalName);

        // Types d'images autorisés en visualisation inline directe
        const isInlineImage = req.query.view === 'inline' && isImageFile(attachment.mime_type, attachment.original_name);
        const dispositionType = isInlineImage ? 'inline' : 'attachment';
        const finalContentType = isInlineImage
            ? getMimeType(attachment.original_name, attachment.mime_type)
            : (attachment.mime_type || 'application/octet-stream');

        res.setHeader('Content-Type', finalContentType);
        res.setHeader('Content-Length', attachment.file_size);
        res.setHeader('Content-Disposition', `${dispositionType}; filename="${safeOriginalName}"; filename*=UTF-8''${encodedName}`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=86400');

        const readStream = fs.createReadStream(filePath);
        readStream.on('error', (err) => {
            console.error('[ATTACHMENT] Erreur lecture fichier download :', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Erreur lors de la lecture du fichier.' });
            }
        });
        readStream.pipe(res);
    } catch (err) {
        console.error('[ATTACHMENT] Erreur route download :', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

module.exports = router;

