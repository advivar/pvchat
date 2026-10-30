// frontend/scripts/crypto.js

// 1. Générer une paire de clés ECDH pour l'utilisateur
async function generateKeyPair() {
    return await window.crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveKey", "deriveBits"]
    );
}

// 2. Exporter la clé publique en chaîne de caractères Base64 (pour l'envoyer au serveur)
async function exportPublicKey(key) {
    const exported = await window.crypto.subtle.exportKey("spki", key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

// 3. Importer la clé publique d'un destinataire reçue du serveur (depuis Base64)
async function importPublicKey(pemKey) {
    const binaryDer = Uint8Array.from(atob(pemKey), c => c.charCodeAt(0));
    return await window.crypto.subtle.importKey(
        "spki",
        binaryDer,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        []
    );
}

// 4. Dériver une clé symétrique partagée (AES-GCM) entre ma clé privée et la clé publique du destinataire
async function deriveSharedKey(privateKey, publicKey) {
    return await window.crypto.subtle.deriveKey(
        { name: "ECDH", public: publicKey },
        privateKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

// 5. Chiffrer un texte avec la clé partagée
async function encryptMessage(text, sharedKey) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const iv = window.crypto.getRandomValues(new Uint8Array(12)); // IV unique par message

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

// 6. Déchiffrer un message reçu
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
        console.error("Échec du déchiffrement :", e);
        return "⚠️ [Message chiffré - Impossible de déchiffrer]";
    }
}

// Sauvegarder la clé privée localement dans le navigateur
async function storePrivateKey(privateKey) {
    const exported = await window.crypto.subtle.exportKey("pkcs8", privateKey);
    localStorage.setItem("pvchat_private_key", btoa(String.fromCharCode(...new Uint8Array(exported))));
}

// Charger la clé privée locale
async function getLocalPrivateKey() {
    const pem = localStorage.getItem("pvchat_private_key");
    if (!pem) return null;
    const binaryDer = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
    return await window.crypto.subtle.importKey(
        "pkcs8",
        binaryDer,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveKey", "deriveBits"]
    );
}