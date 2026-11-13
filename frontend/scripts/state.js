// État global de l'application et gestionnaires d'état

export const state = {
    currentUser: null,
    conversations: [],
    currentConversationId: null,
    unlockedConversationId: null,

    // Cles cryptographiques ECDH de l'utilisateur connecte
    myPrivateKey: null,
    myPublicKeyBase64: null,

    // Callbacks d'interface partages
    openConversationCallback: null,
    openSettingsCallback: null,

    // Pièces jointes en attente d'envoi dans le message courant (tableau d'objets)
    stagedAttachments: []
};

// Synchronise le drapeau `unlocked` sur chaque conversation en memoire
export function syncUnlockedState() {
    state.conversations.forEach(c => {
        c.unlocked = Boolean(c.id === state.unlockedConversationId);
    });
}

// Renvoie la conversation actuellement active
export function getCurrentConversation() {
    if (!state.currentConversationId) return null;
    return state.conversations.find(c => c.id === state.currentConversationId) || null;
}

// Met a jour l'affichage du bouton de verrouillage dans le header
export function updateLockBtnVisibility(conv) {
    const lockBtn = document.getElementById("lockConvBtn");
    if (!lockBtn) return;
    const target = conv || getCurrentConversation();
    if (target && target.has_password && state.unlockedConversationId === target.id) {
        lockBtn.style.display = "inline-flex";
    } else {
        lockBtn.style.display = "none";
    }
}
