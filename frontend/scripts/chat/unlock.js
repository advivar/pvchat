// Gestion de l'écran de déverrouillage inline et du verrouillage instantané

import { state, updateLockBtnVisibility, syncUnlockedState } from '../state.js';
import { apiUnlockConversation } from '../api.js';
import { hideWelcomeScreen, renderConversationList } from '../ui.js';
import { loadAndDisplayMessages, updateConversationPreviews } from './messages.js';

const EYE_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
const EYE_OFF_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

// Affiche l'ecran de deverrouillage a la place des messages
export function showInlineUnlockScreen(conv) {
    hideWelcomeScreen();
    const messagesZone = document.getElementById("messages");
    if (messagesZone) {
        messagesZone.style.display = "none";
        messagesZone.innerHTML = "";
    }
    const unlockScreen = document.getElementById("chatUnlockScreen");
    if (unlockScreen) unlockScreen.style.display = "flex";

    const pwdInput = document.getElementById("inlineUnlockPassword");
    const errorEl = document.getElementById("inlineUnlockError");
    if (pwdInput) {
        pwdInput.value = "";
        pwdInput.type = "password";
        setTimeout(() => pwdInput.focus(), 60);
    }
    const toggleBtn = document.getElementById("inlineUnlockToggleBtn");
    if (toggleBtn) {
        toggleBtn.innerHTML = EYE_ICON_SVG;
        toggleBtn.title = "Afficher le mot de passe";
    }
    if (errorEl) {
        errorEl.style.display = "none";
        errorEl.textContent = "";
    }

    const msgInput = document.getElementById("messageInput");
    const sendBtn = document.getElementById("sendButton");
    if (msgInput) {
        msgInput.disabled = true;
        msgInput.placeholder = "Discussion verrouillée — déverrouillez-la ci-dessus...";
    }
    if (sendBtn) sendBtn.disabled = true;
}

// Masque l'ecran de deverrouillage
export function hideInlineUnlockScreen() {
    const unlockScreen = document.getElementById("chatUnlockScreen");
    if (unlockScreen) unlockScreen.style.display = "none";
    const pwdInput = document.getElementById("inlineUnlockPassword");
    if (pwdInput) pwdInput.value = "";
    const errorEl = document.getElementById("inlineUnlockError");
    if (errorEl) {
        errorEl.style.display = "none";
        errorEl.textContent = "";
    }
}

// Valide le mot de passe et debloque la consultation
async function submitInlineUnlock() {
    const conv = state.conversations.find(c => c.id === state.currentConversationId);
    if (!conv) return;

    const pwdInput = document.getElementById("inlineUnlockPassword");
    const errorEl = document.getElementById("inlineUnlockError");
    const unlockBtn = document.getElementById("inlineUnlockBtn");
    const password = pwdInput ? pwdInput.value.trim() : "";

    if (!password) {
        if (errorEl) {
            errorEl.textContent = "Veuillez entrer le mot de passe de la discussion.";
            errorEl.style.display = "block";
        }
        if (pwdInput) pwdInput.focus();
        return;
    }

    if (unlockBtn) {
        unlockBtn.disabled = true;
        unlockBtn.textContent = "Déverrouillage...";
    }
    if (errorEl) errorEl.style.display = "none";

    try {
        await apiUnlockConversation(conv.id, password);

        // Deverrouille avec succes pour la consultation courante
        state.unlockedConversationId = conv.id;
        conv.unlocked = true;

        updateLockBtnVisibility(conv);
        hideInlineUnlockScreen();

        const messagesZone = document.getElementById("messages");
        if (messagesZone) messagesZone.style.display = "flex";

        const msgInput = document.getElementById("messageInput");
        const sendBtn = document.getElementById("sendButton");
        if (msgInput) {
            msgInput.disabled = false;
            msgInput.placeholder = "Écrire un message...";
        }
        if (sendBtn) sendBtn.disabled = false;

        await loadAndDisplayMessages(conv);
        await updateConversationPreviews();
        renderConversationList(
            state.conversations,
            state.currentConversationId,
            state.openConversationCallback,
            state.openSettingsCallback
        );
    } catch (err) {
        if (errorEl) {
            errorEl.textContent = err.message || "Mot de passe incorrect.";
            errorEl.style.display = "block";
        }
        if (pwdInput) {
            pwdInput.select();
            pwdInput.focus();
        }
    } finally {
        if (unlockBtn) {
            unlockBtn.disabled = false;
            unlockBtn.textContent = "Déverrouiller la discussion";
        }
    }
}

// Initialise les événements liés au déverrouillage et verrouillage
export function initUnlockEvents() {
    const inlineUnlockBtn = document.getElementById("inlineUnlockBtn");
    const pwdInput = document.getElementById("inlineUnlockPassword");
    const toggleBtn = document.getElementById("inlineUnlockToggleBtn");
    const lockBtn = document.getElementById("lockConvBtn");

    if (inlineUnlockBtn) {
        inlineUnlockBtn.addEventListener("click", submitInlineUnlock);
    }

    if (pwdInput) {
        pwdInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                submitInlineUnlock();
            }
        });
    }

    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            if (!pwdInput) return;
            const isPassword = pwdInput.type === "password";
            pwdInput.type = isPassword ? "text" : "password";
            toggleBtn.innerHTML = isPassword ? EYE_OFF_ICON_SVG : EYE_ICON_SVG;
            toggleBtn.title = isPassword ? "Masquer le mot de passe" : "Afficher le mot de passe";
        });
    }

    // Bouton de verrouillage instantané
    if (lockBtn) {
        lockBtn.addEventListener("click", () => {
            const conv = state.conversations.find(c => c.id === state.currentConversationId);
            if (!conv || !conv.has_password) return;

            state.unlockedConversationId = null;
            conv.unlocked = false;
            syncUnlockedState();
            updateLockBtnVisibility(conv);
            showInlineUnlockScreen(conv);
            renderConversationList(
                state.conversations,
                state.currentConversationId,
                state.openConversationCallback,
                state.openSettingsCallback
            );
        });
    }
}
