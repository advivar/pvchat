// Service de gestion du stockage des fichiers, quotas et nettoyage anti-DoS

const fs = require('fs');
const path = require('path');
const { UPLOAD_DIR, MAX_STORAGE_QUOTA, ATTACHMENT_TTL_DAYS } = require('../config');
const attachmentRepo = require('../db/repositories/attachmentRepository');

// S'assure que le répertoire d'upload existe
function ensureUploadDir() {
    if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
    }
}

// Calcule l'espace total occupé sur disque dans le dossier uploads
function getDirectorySizeBytes(dirPath = UPLOAD_DIR) {
    if (!fs.existsSync(dirPath)) return 0;
    let totalSize = 0;
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isFile()) {
                const stats = fs.statSync(fullPath);
                totalSize += stats.size;
            }
        }
    } catch (err) {
        console.error('[STORAGE] Erreur lecture taille dossier uploads :', err);
    }
    return totalSize;
}

// Vérifie si le serveur dispose du quota suffisant pour accepter le fichier
async function hasStorageCapacity(incomingBytes = 0) {
    const diskBytes = getDirectorySizeBytes();
    if (diskBytes + incomingBytes > MAX_STORAGE_QUOTA) {
        console.warn(`[STORAGE QUOTA] Limite dépassée : ${diskBytes + incomingBytes} > ${MAX_STORAGE_QUOTA}`);
        return false;
    }
    return true;
}

// Suppression sécurisée d'un fichier physique
function safeDeleteFile(filePath) {
    if (!filePath) return;
    try {
        // Empêche la sortie du dossier UPLOAD_DIR
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(path.resolve(UPLOAD_DIR))) {
            console.warn('[STORAGE] Tentative de suppression hors du dossier uploads ignorée :', filePath);
            return;
        }
        if (fs.existsSync(resolved)) {
            fs.unlinkSync(resolved);
        }
    } catch (err) {
        console.error('[STORAGE] Erreur suppression fichier :', filePath, err);
    }
}

// Nettoyage automatique des fichiers orphelins (> 2h sans message associé) et anciens (> TTL)
async function runCleanupTask() {
    try {
        ensureUploadDir();
        // 1. Nettoyage des orphelins (uploadés mais jamais envoyés dans un message)
        const orphans = await attachmentRepo.getOrphanedOlderThan(2);
        for (const item of orphans) {
            safeDeleteFile(item.storage_path);
            await attachmentRepo.deleteAttachment(item.id);
        }
        if (orphans.length > 0) {
            console.log(`[STORAGE CLEANUP] ${orphans.length} fichier(s) orphelin(s) supprimé(s).`);
        }

        // 2. Nettoyage des fichiers expirés (TTL)
        const expired = await attachmentRepo.getExpiredOlderThan(ATTACHMENT_TTL_DAYS);
        for (const item of expired) {
            safeDeleteFile(item.storage_path);
            await attachmentRepo.deleteAttachment(item.id);
        }
        if (expired.length > 0) {
            console.log(`[STORAGE CLEANUP] ${expired.length} fichier(s) expiré(s) (> ${ATTACHMENT_TTL_DAYS} jours) supprimé(s).`);
        }
    } catch (err) {
        console.error('[STORAGE CLEANUP] Erreur tâche de nettoyage :', err);
    }
}

// Démarrer la tâche récurrente de nettoyage (toutes les heures)
function initStorageCleanup() {
    ensureUploadDir();
    runCleanupTask();
    setInterval(runCleanupTask, 60 * 60 * 1000);
}

module.exports = {
    ensureUploadDir,
    getDirectorySizeBytes,
    hasStorageCapacity,
    safeDeleteFile,
    runCleanupTask,
    initStorageCleanup
};

