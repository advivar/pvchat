// Modale d'informations sur PVCHAT et statut réseau du serveur

import { getWebSocketStatus } from '../websocket.js';

export function initInfoModal() {
    const infoButton = document.getElementById("infoButton");
    const infoModal = document.getElementById("infoModal");
    const closeInfoModal = document.getElementById("closeInfoModal");
    const confirmInfoModal = document.getElementById("confirmInfoModal");

    if (!infoModal) return;

    if (infoButton) {
        infoButton.addEventListener("click", () => {
            const hostEl = document.getElementById("infoServerHost");
            const protoEl = document.getElementById("infoServerProtocol");
            const wsEl = document.getElementById("infoWsStatus");

            if (hostEl) hostEl.textContent = window.location.host;
            if (protoEl) protoEl.textContent = window.location.protocol.replace(":", "").toUpperCase();
            if (wsEl) wsEl.textContent = getWebSocketStatus();

            infoModal.hidden = false;
        });
    }

    if (closeInfoModal) {
        closeInfoModal.addEventListener("click", () => { infoModal.hidden = true; });
    }

    if (confirmInfoModal) {
        confirmInfoModal.addEventListener("click", () => { infoModal.hidden = true; });
    }

    infoModal.addEventListener("click", (e) => {
        if (e.target === infoModal) infoModal.hidden = true;
    });
}
