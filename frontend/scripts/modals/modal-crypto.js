// Modale de diagnostic E2EE et inspection sécurisée des clés de session

import { state } from '../state.js';
import { apiVerifyAccountPassword } from '../api.js';
import { exportPrivateKey, exportRawKey } from '../crypto.js';
import { getWebSocketStatus } from '../websocket.js';

export function initCryptoModal() {
    const chatStatusBtn = document.getElementById("chatStatusBtn");
    const cryptoStatusModal = document.getElementById("cryptoStatusModal");
    const closeCryptoStatusModal = document.getElementById("closeCryptoStatusModal");
    const closeCryptoStatusBtn = document.getElementById("closeCryptoStatusBtn");
    const revealKeysBtn = document.getElementById("revealKeysBtn");
    const hideKeysBtn = document.getElementById("hideKeysBtn");
    const cryptoAccountPassword = document.getElementById("cryptoAccountPassword");
    const revealKeysError = document.getElementById("revealKeysError");
    const keysAuthGate = document.getElementById("keysAuthGate");
    const keysDisplayArea = document.getElementById("keysDisplayArea");

    if (!cryptoStatusModal) return;

    function hideKeysDisplay() {
        if (keysDisplayArea) keysDisplayArea.style.display = "none";
        if (hideKeysBtn) hideKeysBtn.style.display = "none";
        if (keysAuthGate) keysAuthGate.style.display = "flex";
        if (cryptoAccountPassword) cryptoAccountPassword.value = "";
        if (revealKeysError) {
            revealKeysError.style.display = "none";
            revealKeysError.textContent = "";
        }
        const ids = ["keyMyPublic", "keyMyPrivate", "keyContactPublic", "keyShared"];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = "--";
        });
    }

    if (chatStatusBtn) {
        chatStatusBtn.addEventListener("click", () => {
            const conv = state.conversations.find(c => c.id === state.currentConversationId);

            const statusDomain = document.getElementById("statusDomain");
            const statusHttpProto = document.getElementById("statusHttpProto");
            const statusWsProto = document.getElementById("statusWsProto");
            const statusWsState = document.getElementById("statusWsState");

            if (statusDomain) statusDomain.textContent = window.location.hostname || "localhost";
            if (statusHttpProto) {
                statusHttpProto.textContent = `${window.location.protocol.replace(":", "").toUpperCase()} (Port ${window.location.port || (window.location.protocol === "https:" ? "443" : "80")})`;
            }
            if (statusWsProto) {
                statusWsProto.textContent = window.location.protocol === "https:" ? "WSS (WebSocket Sécurisé)" : "WS (WebSocket)";
            }
            if (statusWsState) statusWsState.textContent = getWebSocketStatus();

            const activeContactEl = document.getElementById("statusActiveContact");
            const targetPubKeyEl = document.getElementById("statusTargetPubKey");
            const sharedKeyEl = document.getElementById("statusSharedKey");
            const pwdLockEl = document.getElementById("statusPasswordLock");

            if (activeContactEl) {
                activeContactEl.textContent = conv ? `@${conv.other_username}` : "Aucune discussion active";
            }

            if (targetPubKeyEl && sharedKeyEl) {
                if (conv && conv.sharedKey) {
                    targetPubKeyEl.textContent = "Vérifiée et active 🟢";
                    targetPubKeyEl.className = "status-badge status-badge-ok";
                    sharedKeyEl.textContent = "Dérivée (AES-GCM-256) 🔑";
                    sharedKeyEl.className = "status-badge status-badge-ok";
                } else {
                    targetPubKeyEl.textContent = "En attente d'échange 🟡";
                    targetPubKeyEl.className = "status-badge status-badge-warn";
                    sharedKeyEl.textContent = "En attente 🟡";
                    sharedKeyEl.className = "status-badge status-badge-warn";
                }
            }

            if (pwdLockEl) {
                if (conv && conv.has_password) {
                    pwdLockEl.textContent = "Activée (accès local protégé) 🔒";
                    pwdLockEl.style.color = "#c4b5fd";
                } else {
                    pwdLockEl.textContent = "Désactivée (E2EE standard)";
                    pwdLockEl.style.color = "var(--muted)";
                }
            }

            hideKeysDisplay();
            cryptoStatusModal.hidden = false;
        });
    }

    if (closeCryptoStatusModal) {
        closeCryptoStatusModal.addEventListener("click", () => {
            cryptoStatusModal.hidden = true;
            hideKeysDisplay();
        });
    }

    if (closeCryptoStatusBtn) {
        closeCryptoStatusBtn.addEventListener("click", () => {
            cryptoStatusModal.hidden = true;
            hideKeysDisplay();
        });
    }

    cryptoStatusModal.addEventListener("click", (e) => {
        if (e.target === cryptoStatusModal) {
            cryptoStatusModal.hidden = true;
            hideKeysDisplay();
        }
    });

    // Affichage des cles apres verification du mot de passe de compte
    if (revealKeysBtn) {
        revealKeysBtn.addEventListener("click", async () => {
            const pwd = cryptoAccountPassword ? cryptoAccountPassword.value : "";
            if (!pwd) {
                if (revealKeysError) {
                    revealKeysError.textContent = "Veuillez entrer votre mot de passe de compte.";
                    revealKeysError.style.display = "block";
                }
                return;
            }

            revealKeysBtn.disabled = true;
            revealKeysBtn.textContent = "Vérification...";
            if (revealKeysError) revealKeysError.style.display = "none";

            try {
                await apiVerifyAccountPassword(pwd);

                if (keysAuthGate) keysAuthGate.style.display = "none";
                if (keysDisplayArea) keysDisplayArea.style.display = "flex";
                if (hideKeysBtn) hideKeysBtn.style.display = "inline-flex";

                // Ma cle publique ECDH
                const keyMyPublicEl = document.getElementById("keyMyPublic");
                if (keyMyPublicEl) keyMyPublicEl.textContent = state.myPublicKeyBase64 || "Introuvable";

                // Ma cle privee locale ECDH
                const keyMyPrivateEl = document.getElementById("keyMyPrivate");
                if (keyMyPrivateEl) {
                    if (state.myPrivateKey) {
                        keyMyPrivateEl.textContent = await exportPrivateKey(state.myPrivateKey);
                    } else {
                        keyMyPrivateEl.textContent = "Introuvable (reconnectez-vous)";
                    }
                }

                const conv = state.conversations.find(c => c.id === state.currentConversationId);

                // Cle publique du contact
                const contactWrap = document.getElementById("keyContactPublicWrap");
                const keyContactPublicEl = document.getElementById("keyContactPublic");
                if (conv && conv._targetPubKeyPem) {
                    if (keyContactPublicEl) keyContactPublicEl.textContent = conv._targetPubKeyPem;
                    if (contactWrap) contactWrap.style.display = "flex";
                } else {
                    if (contactWrap) contactWrap.style.display = "none";
                }

                // Cle partagee AES-GCM-256
                const sharedWrap = document.getElementById("keySharedWrap");
                const keySharedEl = document.getElementById("keyShared");
                if (conv && conv.sharedKey) {
                    try {
                        if (keySharedEl) keySharedEl.textContent = await exportRawKey(conv.sharedKey);
                    } catch {
                        if (keySharedEl) keySharedEl.textContent = "Clé active (non exportable)";
                    }
                    if (sharedWrap) sharedWrap.style.display = "flex";
                } else {
                    if (sharedWrap) sharedWrap.style.display = "none";
                }
            } catch (err) {
                if (revealKeysError) {
                    revealKeysError.textContent = err.message || "Mot de passe incorrect.";
                    revealKeysError.style.display = "block";
                }
            } finally {
                revealKeysBtn.disabled = false;
                revealKeysBtn.textContent = "Afficher les clés 👁️";
            }
        });
    }

    if (cryptoAccountPassword) {
        cryptoAccountPassword.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                if (revealKeysBtn) revealKeysBtn.click();
            }
        });
    }

    if (hideKeysBtn) hideKeysBtn.addEventListener("click", hideKeysDisplay);

    // Boutons de copie
    document.querySelectorAll(".copy-key-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const targetEl = document.getElementById(btn.dataset.copyTarget);
            if (!targetEl) return;
            const text = targetEl.textContent.trim();
            if (!text || text === "--") return;

            navigator.clipboard.writeText(text).then(() => {
                const original = btn.textContent;
                btn.textContent = "Copié ✓";
                btn.classList.add("btn-copied");
                setTimeout(() => {
                    btn.textContent = original;
                    btn.classList.remove("btn-copied");
                }, 1500);
            }).catch(() => {
                btn.textContent = "Erreur copie";
            });
        });
    });
}
