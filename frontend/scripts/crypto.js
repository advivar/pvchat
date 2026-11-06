// Fonctions de chiffrement E2EE (ECDH P-256 + AES-GCM-256)

// Generer une paire de cles ECDH pour l'utilisateur
async function generateKeyPair() {
    return await window.crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveKey", "deriveBits"]
    );
}

// Exporter la cle publique en Base64 (pour l'envoyer au serveur)
async function exportPublicKey(key) {
    const exported = await window.crypto.subtle.exportKey("spki", key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

// Importer la cle publique d'un destinataire recue du serveur (depuis Base64)
async function importPublicKey(base64Key) {
    const binaryDer = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
    return await window.crypto.subtle.importKey(
        "spki",
        binaryDer,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        []
    );
}

// Deriver une cle symetrique partagee (AES-GCM-256) a partir des cles ECDH
async function deriveSharedKey(privateKey, publicKey) {
    return await window.crypto.subtle.deriveKey(
        { name: "ECDH", public: publicKey },
        privateKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

// Chiffrer un texte avec la cle partagee (AES-GCM)
async function encryptMessage(text, sharedKey) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        sharedKey,
        data
    );

    return JSON.stringify({
        ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertextBuffer))),
        iv: btoa(String.fromCharCode(...new Uint8Array(iv)))
    });
}

// Dechiffrer un message recu avec la cle partagee
async function decryptMessage(encryptedJsonString, sharedKey) {
    try {
        const { ciphertext, iv } = JSON.parse(encryptedJsonString);
        const ivArray = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
        const ciphertextArray = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));

        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: ivArray },
            sharedKey,
            ciphertextArray
        );

        const decoder = new TextDecoder();
        return decoder.decode(decryptedBuffer);
    } catch (e) {
        console.error("Echec du dechiffrement :", e);
        return "⚠️ [Message chiffré - Impossible de déchiffrer]";
    }
}

// Sauvegarder la cle privee localement dans le navigateur (ne sort jamais du client)
async function storePrivateKey(privateKey) {
    const exported = await window.crypto.subtle.exportKey("pkcs8", privateKey);
    localStorage.setItem("pvchat_private_key", btoa(String.fromCharCode(...new Uint8Array(exported))));
}

// Charger la cle privee locale depuis le navigateur
async function getLocalPrivateKey() {
    const stored = localStorage.getItem("pvchat_private_key");
    if (!stored) return null;
    const binaryDer = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
    return await window.crypto.subtle.importKey(
        "pkcs8",
        binaryDer,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveKey", "deriveBits"]
    );
}
