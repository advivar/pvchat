// Gestion des pièces jointes : sélection multiple, glisser-déposer (Drag & Drop), staging moderne et prévisualisation

import { state } from '../state.js';
import { escapeHtml } from './format.js';

// Taille maximale par fichier (512 Mo)
export const MAX_FILE_SIZE = 512 * 1024 * 1024;
// Nombre maximal de fichiers joints par message
export const MAX_FILES_COUNT = 10;

// Déduit ou affine le type MIME d'un fichier selon son extension
export function inferMimeType(filename, providedType = '') {
    if (providedType && providedType !== 'application/octet-stream' && providedType.trim().length > 0) {
        return providedType.toLowerCase().trim();
    }
    const ext = filename ? filename.split('.').pop().toLowerCase() : '';
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
    return map[ext] || providedType || 'application/octet-stream';
}

// Formate une taille en octets de manière lisible
export function formatFileSize(bytes) {
    if (bytes === 0 || !bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'Ko', 'Mo', 'Go'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1);
    return `${val} ${sizes[i]}`;
}

// Renvoie une icône SVG stylisée selon le type MIME ou l'extension
export function getFileIconSvg(mimeType = '', filename = '') {
    const ext = filename ? filename.split('.').pop().toLowerCase() : '';
    const mime = (mimeType || '').toLowerCase();

    // Image
    if (mime.startsWith('image/')) {
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;
    }

    // Audio
    if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) {
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
    }

    // Vidéo
    if (mime.startsWith('video/') || ['mp4', 'webm', 'mkv', 'avi', 'mov'].includes(ext)) {
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="15" height="16" rx="2"></rect><path d="m22 7-5 5 5 5V7z"></path></svg>`;
    }

    // Archive
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext) || mime.includes('zip') || mime.includes('compressed') || mime.includes('tar')) {
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path></svg>`;
    }

    // Code
    if (['js', 'ts', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'php', 'sql', 'sh', 'yml', 'yaml'].includes(ext)) {
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`;
    }

    // PDF
    if (ext === 'pdf' || mime === 'application/pdf') {
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
    }

    // Générique
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
}

// Affiche un toast d'alerte temporaire stylisé
export function showAttachmentNotification(message, isError = true) {
    let toast = document.getElementById("attachmentToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "attachmentToast";
        toast.className = "attachment-toast";
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `attachment-toast ${isError ? 'error' : 'success'} show`;
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.remove("show");
    }, 4500);
}

// Intègre un ou plusieurs fichiers en attente (staging) sans les envoyer immédiatement
export function stageFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    if (!state.currentConversationId) {
        showAttachmentNotification("Veuillez sélectionner une discussion avant de joindre des fichiers.", true);
        return;
    }

    if (!Array.isArray(state.stagedAttachments)) {
        state.stagedAttachments = [];
    }

    const files = Array.from(fileList);
    let addedCount = 0;

    for (const file of files) {
        if (state.stagedAttachments.length >= MAX_FILES_COUNT) {
            showAttachmentNotification(`Limite maximale atteinte : ${MAX_FILES_COUNT} fichiers par message.`, true);
            break;
        }

        // Vérification stricte de la taille (512 Mo par fichier)
        if (file.size > MAX_FILE_SIZE) {
            showAttachmentNotification(
                `Le fichier "${file.name}" (${formatFileSize(file.size)}) dépasse la taille maximale autorisée de 512 Mo.`,
                true
            );
            continue;
        }

        // Évite les doublons exacts
        const isDuplicate = state.stagedAttachments.some(item => item.name === file.name && item.size === file.size);
        if (isDuplicate) continue;

        const refinedType = inferMimeType(file.name, file.type);
        let objectUrl = null;
        const isImage = refinedType.startsWith('image/');
        if (isImage) {
            try {
                objectUrl = URL.createObjectURL(file);
            } catch {}
        }

        state.stagedAttachments.push({
            id: 'staged_' + Math.random().toString(36).substring(2, 10),
            file,
            name: file.name,
            size: file.size,
            type: refinedType,
            previewUrl: objectUrl
        });

        addedCount++;
    }

    if (addedCount > 0) {
        renderStagedPreviews();
        const msgInput = document.getElementById("messageInput");
        if (msgInput) msgInput.focus();
    }
}

// Retire un fichier spécifique de la liste en attente
export function removeStagedAttachment(index) {
    if (!Array.isArray(state.stagedAttachments) || index < 0 || index >= state.stagedAttachments.length) return;

    const removed = state.stagedAttachments.splice(index, 1)[0];
    if (removed && removed.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
    }

    renderStagedPreviews();
}

// Réinitialise tous les fichiers en attente
export function clearStagedAttachment() {
    if (Array.isArray(state.stagedAttachments)) {
        for (const item of state.stagedAttachments) {
            if (item.previewUrl) {
                URL.revokeObjectURL(item.previewUrl);
            }
        }
        state.stagedAttachments = [];
    }

    const previewContainer = document.getElementById("attachmentPreview");
    const previewList = document.getElementById("attachmentPreviewList");
    const progressBar = document.getElementById("attachmentProgressBar");
    const progressFill = document.getElementById("attachmentProgressFill");
    const fileInput = document.getElementById("attachmentFileInput");

    if (previewContainer) previewContainer.style.display = "none";
    if (previewList) previewList.innerHTML = "";
    if (progressBar) progressBar.style.display = "none";
    if (progressFill) progressFill.style.width = "0%";
    if (fileInput) fileInput.value = "";
}

// Rendu visuel de la liste des cartes rectangulaires modernes de prévisualisation
export function renderStagedPreviews() {
    const previewContainer = document.getElementById("attachmentPreview");
    const previewList = document.getElementById("attachmentPreviewList");
    const fileInput = document.getElementById("attachmentFileInput");

    if (!previewContainer || !previewList) return;

    if (!Array.isArray(state.stagedAttachments) || state.stagedAttachments.length === 0) {
        previewContainer.style.display = "none";
        previewList.innerHTML = "";
        if (fileInput) fileInput.value = "";
        return;
    }

    previewList.innerHTML = "";

    state.stagedAttachments.forEach((item, index) => {
        const isImage = Boolean(item.type && item.type.startsWith('image/'));

        const card = document.createElement("div");
        card.className = "attachment-preview-card";
        card.dataset.index = index;

        // Miniature ou icône
        const thumb = document.createElement("div");
        thumb.className = `attachment-card-thumb ${isImage ? 'is-image' : 'is-file'}`;

        if (isImage && item.previewUrl) {
            thumb.innerHTML = `<img src="${item.previewUrl}" alt="Aperçu miniature" class="attachment-card-img" />`;
        } else {
            thumb.innerHTML = getFileIconSvg(item.type, item.name);
        }

        // Informations (nom + taille)
        const info = document.createElement("div");
        info.className = "attachment-card-info";
        info.innerHTML = `
            <span class="attachment-card-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
            <span class="attachment-card-size">${formatFileSize(item.size)}</span>
        `;

        // Croix de suppression améliorée
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "attachment-card-remove-btn";
        removeBtn.title = `Retirer "${escapeHtml(item.name)}"`;
        removeBtn.setAttribute("aria-label", "Retirer le fichier");
        removeBtn.innerHTML = `
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;

        removeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            removeStagedAttachment(index);
        });

        card.appendChild(thumb);
        card.appendChild(info);
        card.appendChild(removeBtn);
        previewList.appendChild(card);
    });

    previewContainer.style.display = "flex";
}

// Met à jour la barre de progression globale d'upload
export function updateAttachmentProgress(percent, label = "") {
    const progressBar = document.getElementById("attachmentProgressBar");
    const progressFill = document.getElementById("attachmentProgressFill");

    if (progressBar) progressBar.style.display = "block";
    if (progressFill) progressFill.style.width = `${percent}%`;
}

// Ouvre l'encart d'aperçu d'image en grand format (Lightbox) au centre de l'écran
export function openImageLightbox(imageUrl, imageName = "Image", downloadUrl = "") {
    const modal = document.getElementById("imageLightboxModal");
    const img = document.getElementById("lightboxImg");
    const title = document.getElementById("lightboxImageTitle");
    const dlBtn = document.getElementById("lightboxDownloadBtn");

    if (!modal || !img) return;

    img.src = imageUrl;
    if (title) title.textContent = imageName;
    if (dlBtn) {
        dlBtn.href = downloadUrl || imageUrl;
        dlBtn.download = imageName || "image";
    }

    modal.style.display = "flex";
    document.body.classList.add("lightbox-open");
}

// Ferme l'encart d'aperçu d'image (Lightbox)
export function closeImageLightbox() {
    const modal = document.getElementById("imageLightboxModal");
    const img = document.getElementById("lightboxImg");
    if (!modal) return;
    modal.style.display = "none";
    if (img) img.src = "";
    document.body.classList.remove("lightbox-open");
}

// Initialise les écouteurs de la modale Lightbox
export function initLightboxEvents() {
    const modal = document.getElementById("imageLightboxModal");
    const backdrop = document.getElementById("lightboxBackdrop");
    const closeBtn = document.getElementById("lightboxCloseBtn");
    const imgWrapper = document.getElementById("lightboxImgWrapper");

    if (!modal) return;

    if (backdrop) backdrop.addEventListener("click", closeImageLightbox);
    if (closeBtn) closeBtn.addEventListener("click", closeImageLightbox);
    if (imgWrapper) {
        imgWrapper.addEventListener("click", (e) => {
            // Ferme si on clique en dehors de l'image
            if (e.target === imgWrapper) closeImageLightbox();
        });
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.style.display !== "none") {
            closeImageLightbox();
        }
    });
}

// Initialise le bouton d'attachement et le glisser-déposer sur le site
export function initAttachmentHandlers() {
    const attachBtn = document.getElementById("attachmentButton");
    const fileInput = document.getElementById("attachmentFileInput");
    const dropOverlay = document.getElementById("dropzoneOverlay");

    // 1. Clic sur le bouton '+' -> ouvre le sélecteur de fichiers multiples
    if (attachBtn && fileInput) {
        attachBtn.addEventListener("click", () => {
            if (!state.currentConversationId) {
                showAttachmentNotification("Veuillez ouvrir une discussion pour joindre des fichiers.", true);
                return;
            }
            fileInput.value = "";
            fileInput.click();
        });

        fileInput.addEventListener("change", (e) => {
            if (e.target.files && e.target.files.length > 0) {
                stageFiles(e.target.files);
                fileInput.value = "";
            }
        });
    }

    // 2. Glisser-déposer (Drag & Drop) global avec encart visuel
    let dragCounter = 0;

    const showOverlay = () => {
        if (dropOverlay && state.currentConversationId) {
            dropOverlay.style.display = "flex";
        }
    };

    const hideOverlay = () => {
        if (dropOverlay) {
            dropOverlay.style.display = "none";
        }
    };

    window.addEventListener("dragenter", (e) => {
        if (!state.currentConversationId) return;
        if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes("Files")) {
            dragCounter++;
            showOverlay();
        }
    });

    window.addEventListener("dragleave", (e) => {
        if (!state.currentConversationId) return;
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            hideOverlay();
        }
    });

    window.addEventListener("dragover", (e) => {
        if (!state.currentConversationId) return;
        if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        }
    });

    window.addEventListener("drop", (e) => {
        if (!state.currentConversationId) return;
        e.preventDefault();
        dragCounter = 0;
        hideOverlay();

        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            stageFiles(e.dataTransfer.files);
        }
    });

    // 3. Initialisation de la modale Lightbox
    initLightboxEvents();
}
