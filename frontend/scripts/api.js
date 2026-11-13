// Toutes les fonctions qui communiquent avec l'API backend

const API_BASE = "/api";

export function authHeaders() {
    const token = localStorage.getItem("pvchat_token");
    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
    };
}

export async function apiGetMe() {
    const res = await fetch(`${API_BASE}/me`, { headers: authHeaders() });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.user) {
        data.user.id = data.user.id || data.user.userId;
        data.user.userId = data.user.id;
        return data.user;
    }
    return null;
}

export async function apiGetConversations() {
    const res = await fetch(`${API_BASE}/conversations`, { headers: authHeaders() });
    if (res.status === 401) {
        localStorage.removeItem("pvchat_token");
        window.location.reload();
        return [];
    }
    return await res.json();
}

export async function apiCreateConversation(targetUserId) {
    const res = await fetch(`${API_BASE}/conversations`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ targetUserId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur serveur");
    return data.conversation;
}

export async function apiGetMessages(convId) {
    const res = await fetch(`${API_BASE}/conversations/${convId}/messages`, { headers: authHeaders() });
    if (!res.ok) return [];
    return await res.json();
}

export async function apiSendMessage(convId, content, attachmentIds = null) {
    const payload = { content };
    if (Array.isArray(attachmentIds)) {
        payload.attachmentIds = attachmentIds;
        if (attachmentIds.length > 0) {
            payload.attachmentId = attachmentIds[0];
        }
    } else if (attachmentIds) {
        payload.attachmentId = attachmentIds;
    }
    const res = await fetch(`${API_BASE}/conversations/${convId}/messages`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur serveur");
    return data;
}

// Upload d'une pièce jointe avec suivi de la progression
export function apiUploadAttachment(convId, file, onProgress = null) {
    return new Promise((resolve, reject) => {
        const token = localStorage.getItem("pvchat_token");
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        formData.append("file", file);
        formData.append("conversation_id", convId);

        xhr.open("POST", `${API_BASE}/attachments/upload?conversation_id=${encodeURIComponent(convId)}`);
        if (token) {
            xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        }

        if (xhr.upload && onProgress) {
            xhr.upload.addEventListener("progress", (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    onProgress(percent, e.loaded, e.total);
                }
            });
        }

        xhr.onload = () => {
            let data = null;
            try {
                data = JSON.parse(xhr.responseText);
            } catch {
                data = { error: "Réponse serveur invalide." };
            }

            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(data);
            } else {
                reject(new Error(data.error || `Erreur transfert (${xhr.status})`));
            }
        };

        xhr.onerror = () => reject(new Error("Erreur réseau lors de l'envoi du fichier."));
        xhr.ontimeout = () => reject(new Error("Délai de connexion dépassé pendant l'envoi."));

        xhr.send(formData);
    });
}

export async function apiSearchUsers(query) {
    const token = localStorage.getItem("pvchat_token");
    const res = await fetch(`${API_BASE}/users/search?q=${encodeURIComponent(query)}`, {
        headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Erreur serveur");
    return await res.json();
}

// Enregistrer la cle publique E2EE sur le serveur
export async function apiSavePublicKey(publicKey) {
    const res = await fetch(`${API_BASE}/users/me/public-key`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ public_key: publicKey })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur sauvegarde cle publique");
    return data;
}

// Recuperer la cle publique E2EE d'un autre utilisateur
export async function apiGetUserPublicKey(userId) {
    const res = await fetch(`${API_BASE}/users/${userId}/public-key`, {
        headers: authHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur recuperation cle publique");
    return data.public_key;
}

// Supprimer (masquer) une conversation de son compte
export async function apiDeleteConversation(convId) {
    const res = await fetch(`${API_BASE}/conversations/${convId}`, {
        method: "DELETE",
        headers: authHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur suppression conversation");
    return data;
}

// Definir, modifier ou supprimer le mot de passe d'une conversation
export async function apiSetConversationPassword(convId, password, currentPassword) {
    const res = await fetch(`${API_BASE}/conversations/${convId}/password`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ password, currentPassword })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur configuration mot de passe");
    return data;
}

// Deverrouiller une conversation protegee par mot de passe
export async function apiUnlockConversation(convId, password) {
    const res = await fetch(`${API_BASE}/conversations/${convId}/unlock`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Mot de passe incorrect");
    return data;
}

// Verifier le mot de passe du compte (pour confirmation de securite / afficher les cles)
export async function apiVerifyAccountPassword(password) {
    const res = await fetch(`${API_BASE}/verify-password`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Mot de passe du compte incorrect");
    return data;
}
