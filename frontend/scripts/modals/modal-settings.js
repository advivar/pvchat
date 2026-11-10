// Modale des paramètres de conversation (mot de passe et suppression)

import { state, updateLockBtnVisibility } from '../state.js';
import { apiSetConversationPassword, apiDeleteConversation } from '../api.js';
import { showWelcomeScreen, resetChatHeader } from '../ui.js';
import { showInlineUnlockScreen, hideInlineUnlockScreen } from '../chat/unlock.js';
import { loadAndDisplayMessages, refreshConversations } from '../chat/messages.js';

let settingsTargetConvId = null;

function showSettingsFeedback(message, isError = false) {
    const feedback = document.getElementById("convSettingsFeedback");
    if (!feedback) return;
    feedback.textContent = message;
    feedback.className = `settings-feedback ${isError ? "settings-feedback-error" : "settings-feedback-success"}`;
    feedback.hidden = false;
}

function clearSettingsFeedback() {
    const feedback = document.getElementById("convSettingsFeedback");
    if (!feedback) return;
    feedback.hidden = true;
    feedback.textContent = "";
}

export function openConversationSettings(convId) {
    settingsTargetConvId = parseInt(convId);
    const conv = state.conversations.find(c => c.id === settingsTargetConvId);
    if (!conv) return;

    const titleEl = document.getElementById("convSettingsTitle");
    if (titleEl) titleEl.textContent = `Paramètres — ${conv.other_username}`;

    const convPasswordInput = document.getElementById("convPasswordInput");
    if (convPasswordInput) convPasswordInput.value = "";
    clearSettingsFeedback();

    const currentPwdFieldWrap = document.getElementById("currentPwdFieldWrap");
    const newPwdFieldLabel = document.getElementById("newPwdFieldLabel");
    const currentConvPasswordInput = document.getElementById("currentConvPasswordInput");
    const removeConvPasswordInput = document.getElementById("removeConvPasswordInput");
    const pwdStatusNotice = document.getElementById("pwdStatusNotice");
    const removeConvPasswordBtn = document.getElementById("removeConvPasswordBtn");
    const saveConvPasswordBtn = document.getElementById("saveConvPasswordBtn");
    const removePwdConfirmBox = document.getElementById("removePwdConfirmBox");
    const deleteConvConfirmBox = document.getElementById("deleteConvConfirmBox");

    if (currentConvPasswordInput) currentConvPasswordInput.value = "";
    if (removeConvPasswordInput) removeConvPasswordInput.value = "";
    if (removePwdConfirmBox) removePwdConfirmBox.hidden = true;
    if (deleteConvConfirmBox) deleteConvConfirmBox.hidden = true;

    if (conv.has_password) {
        if (pwdStatusNotice) {
            pwdStatusNotice.hidden = false;
            pwdStatusNotice.textContent = "Cette discussion est actuellement protégée par un mot de passe.";
        }
        if (currentPwdFieldWrap) currentPwdFieldWrap.hidden = false;
        if (newPwdFieldLabel) newPwdFieldLabel.style.display = "block";
        if (removeConvPasswordBtn) removeConvPasswordBtn.hidden = false;
        if (saveConvPasswordBtn) saveConvPasswordBtn.textContent = "Modifier le mot de passe";
    } else {
        if (pwdStatusNotice) pwdStatusNotice.hidden = true;
        if (currentPwdFieldWrap) currentPwdFieldWrap.hidden = true;
        if (newPwdFieldLabel) newPwdFieldLabel.style.display = "none";
        if (removeConvPasswordBtn) removeConvPasswordBtn.hidden = true;
        if (saveConvPasswordBtn) saveConvPasswordBtn.textContent = "Définir le mot de passe";
    }

    const modal = document.getElementById("convSettingsModal");
    if (modal) modal.hidden = false;
}

export function initSettingsModal() {
    const modal = document.getElementById("convSettingsModal");
    const closeBtn = document.getElementById("closeConvSettingsModal");
    const saveBtn = document.getElementById("saveConvPasswordBtn");
    const removeBtn = document.getElementById("removeConvPasswordBtn");
    const deleteBtn = document.getElementById("deleteConvBtn");
    const convPasswordInput = document.getElementById("convPasswordInput");
    const currentConvPasswordInput = document.getElementById("currentConvPasswordInput");
    const cancelRemovePwdBtn = document.getElementById("cancelRemovePwdBtn");
    const confirmRemovePwdBtn = document.getElementById("confirmRemovePwdBtn");
    const removePwdConfirmBox = document.getElementById("removePwdConfirmBox");
    const cancelDeleteConvBtn = document.getElementById("cancelDeleteConvBtn");
    const confirmDeleteConvBtn = document.getElementById("confirmDeleteConvBtn");
    const deleteConvConfirmBox = document.getElementById("deleteConvConfirmBox");

    if (!modal) return;

    if (closeBtn) {
        closeBtn.addEventListener("click", () => { modal.hidden = true; });
    }

    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.hidden = true;
    });

    // Definir ou modifier le mot de passe
    if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
            if (!convPasswordInput) return;
            const pwd = convPasswordInput.value.trim();
            if (!pwd || pwd.length < 4) {
                showSettingsFeedback("Le mot de passe doit contenir au moins 4 caractères.", true);
                return;
            }

            const conv = state.conversations.find(c => c.id === settingsTargetConvId);
            let currentPwd = null;
            if (conv && conv.has_password) {
                currentPwd = currentConvPasswordInput ? currentConvPasswordInput.value.trim() : "";
                if (!currentPwd) {
                    showSettingsFeedback("Veuillez saisir le mot de passe actuel pour modifier la protection.", true);
                    return;
                }
            }

            try {
                await apiSetConversationPassword(settingsTargetConvId, pwd, currentPwd);
                if (conv) {
                    conv.has_password = true;
                    conv.unlocked = false;
                    if (state.unlockedConversationId === settingsTargetConvId) {
                        state.unlockedConversationId = null;
                    }

                    if (state.currentConversationId === settingsTargetConvId) {
                        updateLockBtnVisibility(conv);
                        showInlineUnlockScreen(conv);
                    }
                }
                showSettingsFeedback("Mot de passe enregistré ! Discussion protégée 🔒", false);
                convPasswordInput.value = "";
                await refreshConversations();
                setTimeout(() => { modal.hidden = true; }, 1200);
            } catch (err) {
                showSettingsFeedback(err.message || "Erreur lors de l'enregistrement du mot de passe.", true);
            }
        });
    }

    if (convPasswordInput) {
        convPasswordInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                if (saveBtn) saveBtn.click();
            }
        });
    }

    if (currentConvPasswordInput) {
        currentConvPasswordInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                if (saveBtn) saveBtn.click();
            }
        });
    }

    // Supprimer le mot de passe
    if (removeBtn) {
        removeBtn.addEventListener("click", () => {
            if (removePwdConfirmBox) removePwdConfirmBox.hidden = false;
            const inp = document.getElementById("removeConvPasswordInput");
            if (inp) {
                inp.value = "";
                inp.focus();
            }
            clearSettingsFeedback();
        });
    }

    if (cancelRemovePwdBtn) {
        cancelRemovePwdBtn.addEventListener("click", () => {
            if (removePwdConfirmBox) removePwdConfirmBox.hidden = true;
        });
    }

    if (confirmRemovePwdBtn) {
        confirmRemovePwdBtn.addEventListener("click", async () => {
            const inp = document.getElementById("removeConvPasswordInput");
            const currentPwd = inp ? inp.value.trim() : "";

            if (!currentPwd) {
                showSettingsFeedback("Veuillez saisir le mot de passe actuel pour confirmer la suppression.", true);
                if (inp) inp.focus();
                return;
            }

            try {
                await apiSetConversationPassword(settingsTargetConvId, null, currentPwd);
                const conv = state.conversations.find(c => c.id === settingsTargetConvId);
                if (conv) {
                    conv.has_password = false;
                    conv.unlocked = true;
                    state.unlockedConversationId = conv.id;

                    if (state.currentConversationId === settingsTargetConvId) {
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
                    }
                }
                if (removePwdConfirmBox) removePwdConfirmBox.hidden = true;
                showSettingsFeedback("Protection supprimée. Discussion déverrouillée !", false);
                await refreshConversations();
                setTimeout(() => { modal.hidden = true; }, 1200);
            } catch (err) {
                showSettingsFeedback(err.message || "Erreur lors de la suppression du mot de passe.", true);
            }
        });
    }

    const removeConvPasswordInput = document.getElementById("removeConvPasswordInput");
    if (removeConvPasswordInput) {
        removeConvPasswordInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                if (confirmRemovePwdBtn) confirmRemovePwdBtn.click();
            }
        });
    }

    // Supprimer la conversation du compte
    if (deleteBtn) {
        deleteBtn.addEventListener("click", () => {
            if (deleteConvConfirmBox) deleteConvConfirmBox.hidden = false;
            clearSettingsFeedback();
        });
    }

    if (cancelDeleteConvBtn) {
        cancelDeleteConvBtn.addEventListener("click", () => {
            if (deleteConvConfirmBox) deleteConvConfirmBox.hidden = true;
        });
    }

    if (confirmDeleteConvBtn) {
        confirmDeleteConvBtn.addEventListener("click", async () => {
            try {
                await apiDeleteConversation(settingsTargetConvId);
                if (deleteConvConfirmBox) deleteConvConfirmBox.hidden = true;
                modal.hidden = true;

                if (state.currentConversationId === settingsTargetConvId) {
                    state.currentConversationId = null;
                    state.unlockedConversationId = null;
                    showWelcomeScreen();
                    resetChatHeader();
                    hideInlineUnlockScreen();
                    const msgInput = document.getElementById("messageInput");
                    const sendBtn = document.getElementById("sendButton");
                    if (msgInput) {
                        msgInput.disabled = true;
                        msgInput.placeholder = "Sélectionnez une conversation...";
                    }
                    if (sendBtn) sendBtn.disabled = true;
                }

                await refreshConversations();
            } catch (err) {
                showSettingsFeedback(err.message || "Erreur lors de la suppression.", true);
            }
        });
    }
}
