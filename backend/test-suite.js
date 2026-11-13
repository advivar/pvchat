// Suite de tests automatisés pour PVCHAT (Auth, E2EE keys, Conversations, Messages, Verrouillage)

const http = require('http');

function request(options, data = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                let parsed = body;
                try { parsed = JSON.parse(body); } catch {}
                resolve({ status: res.statusCode, headers: res.headers, data: parsed, rawBody: body });
            });
        });
        req.on('error', reject);
        if (data) {
            req.write(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
        }
        req.end();
    });
}

function uploadMultipart(options, filename, fileBuffer, fields = {}) {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const parts = [];
    for (const [key, val] of Object.entries(fields)) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`));
    }
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    parts.push(fileBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const fullBody = Buffer.concat(parts);

    const headers = Object.assign({}, options.headers, {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': fullBody.length
    });

    return request(Object.assign({}, options, { headers }), fullBody);
}

async function runTests() {
    console.log('--- DEBUT DE LA SUITE DE TESTS PVCHAT ---');
    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`  ✓ ${message}`);
            passed++;
        } else {
            console.error(`  ✗ ECHEC: ${message}`);
            failed++;
        }
    }

    const testSuffix = Math.floor(Math.random() * 900000 + 100000);
    const aliceUser = `alice_${testSuffix}`;
    const bobUser = `bob_${testSuffix}`;
    const password = 'Password123!';

    let aliceToken = null;
    let bobToken = null;
    let aliceId = null;
    let bobId = null;
    let convId = null;

    try {
        // 1. Inscription Alice
        console.log('\n[1] Inscription');
        const regAlice = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: '/register',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { username: aliceUser, password });
        assert(regAlice.status === 201, `Inscription Alice réussie (status 201, got ${regAlice.status})`);
        aliceId = regAlice.data && regAlice.data.user ? regAlice.data.user.id : null;

        // 2. Inscription Bob
        const regBob = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: '/register',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { username: bobUser, password });
        assert(regBob.status === 201, `Inscription Bob réussie (status 201, got ${regBob.status})`);
        bobId = regBob.data && regBob.data.user ? regBob.data.user.id : null;

        // 3. Connexion Alice
        console.log('\n[2] Connexion & Tokens JWT');
        const loginAlice = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: '/login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { username: aliceUser, password });
        assert(loginAlice.status === 200 && loginAlice.data.token, `Connexion Alice réussie avec token JWT`);
        aliceToken = loginAlice.data.token;

        // 4. Connexion Bob
        const loginBob = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: '/login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { username: bobUser, password });
        assert(loginBob.status === 200 && loginBob.data.token, `Connexion Bob réussie avec token JWT`);
        bobToken = loginBob.data.token;

        // 5. Verification mot de passe de compte
        console.log('\n[3] Vérification mot de passe de compte (/verify-password)');
        const verifyAlice = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: '/verify-password',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aliceToken}`
            }
        }, { password });
        assert(verifyAlice.status === 200 && verifyAlice.data.valid === true, `Mot de passe du compte vérifié`);

        const verifyFail = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: '/verify-password',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aliceToken}`
            }
        }, { password: 'wrongPassword!' });
        assert(verifyFail.status === 401, `Rejet du mauvais mot de passe compte (status 401)`);

        // 6. Gestion des clés publiques E2EE
        console.log('\n[4] Clés publiques E2EE');
        const fakePublicKey = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEfakePublicKeyBase64Test==";
        const setKey = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: '/users/me/public-key',
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aliceToken}`
            }
        }, { public_key: fakePublicKey });
        assert(setKey.status === 200, `Sauvegarde de la clé publique d'Alice`);

        const getKey = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: `/users/${aliceId}/public-key`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${bobToken}` }
        });
        assert(getKey.status === 200 && getKey.data.public_key === fakePublicKey, `Bob récupère la clé publique d'Alice`);

        // 7. Recherche d'utilisateurs
        console.log('\n[5] Recherche utilisateurs (/users/search)');
        const searchRes = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: `/users/search?q=${bobUser.slice(0, 5)}`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${aliceToken}` }
        });
        assert(searchRes.status === 200 && Array.isArray(searchRes.data), `Recherche renvoie une liste`);
        const foundBob = searchRes.data.some(u => u.username === bobUser);
        assert(foundBob, `Bob trouvé dans les résultats de recherche`);

        // 8. Création de conversation
        console.log('\n[6] Création de conversation');
        const createConv = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: '/conversations',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aliceToken}`
            }
        }, { targetUserId: bobId });
        assert(createConv.status === 201 && createConv.data.conversation, `Conversation créée entre Alice et Bob`);
        convId = createConv.data.conversation.id;

        // 9. Envoi et réception de messages
        console.log('\n[7] Envoi et historique des messages');
        const samplePayload = JSON.stringify({ ciphertext: "k9d8e7...", iv: "123456==" });
        const sendMsg = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: `/conversations/${convId}/messages`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aliceToken}`
            }
        }, { content: samplePayload });
        assert(sendMsg.status === 201 && sendMsg.data.id, `Message envoyé avec succès`);

        const getMsgs = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: `/conversations/${convId}/messages`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${bobToken}` }
        });
        assert(getMsgs.status === 200 && getMsgs.data.length >= 1, `Bob récupère l'historique des messages`);
        assert(getMsgs.data[0].content === samplePayload, `Contenu du message intact (E2EE payload)`);

        // 10. Verrouillage par mot de passe de la discussion
        console.log('\n[8] Protection par mot de passe de discussion');
        const convPassword = 'SecretConvPassword123';
        const setConvPwd = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: `/conversations/${convId}/password`,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aliceToken}`
            }
        }, { password: convPassword });
        assert(setConvPwd.status === 200 && setConvPwd.data.hasPassword === true, `Mot de passe de discussion configuré`);

        // Test déverrouillage mot de passe erroné
        const unlockFail = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: `/conversations/${convId}/unlock`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aliceToken}`
            }
        }, { password: 'wrongPassword' });
        assert(unlockFail.status === 401, `Déverrouillage échoué avec mauvais mot de passe (401)`);

        // Test déverrouillage mot de passe correct
        const unlockSuccess = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: `/conversations/${convId}/unlock`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aliceToken}`
            }
        }, { password: convPassword });
        assert(unlockSuccess.status === 200 && unlockSuccess.data.unlocked === true, `Déverrouillage réussi avec mot de passe correct (200)`);

        // 11. Masquage / suppression de la conversation
        console.log('\n[9] Masquage & réveil de conversation');
        const deleteConv = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: `/conversations/${convId}`,
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${aliceToken}` }
        });
        assert(deleteConv.status === 200, `Conversation masquée du compte d'Alice`);

        const aliceConvs = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: '/conversations',
            method: 'GET',
            headers: { 'Authorization': `Bearer ${aliceToken}` }
        });
        const isHiddenForAlice = !aliceConvs.data.some(c => c.id === convId);
        assert(isHiddenForAlice, `Conversation n'apparaît plus dans la liste d'Alice`);

        // Bob renvoie un message -> doit réveiller la conversation pour Alice
        const bobReply = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: `/conversations/${convId}/messages`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${bobToken}`
            }
        }, { content: 'Reveil conversation !' });
        assert(bobReply.status === 201, `Bob renvoie un message`);

        const aliceConvsAfter = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: '/conversations',
            method: 'GET',
            headers: { 'Authorization': `Bearer ${aliceToken}` }
        });
        const isAwokenForAlice = aliceConvsAfter.data.some(c => c.id === convId);
        assert(isAwokenForAlice, `Conversation réveillée automatiquement pour Alice suite au message de Bob`);

        // 12. Tests des pièces jointes (Upload, Liaison message, Téléchargement sécurisé, Contrôle d'accès)
        console.log('\n[10] Pièces jointes (Upload streamé, Quotas & Sécurité)');
        const dummyFileContent = Buffer.from('Contenu de test pour la piece jointe PVCHAT 512Mo anti-dos.');
        const uploadRes = await uploadMultipart({
            hostname: '127.0.0.1',
            port: 3000,
            path: `/attachments/upload?conversation_id=${convId}`,
            method: 'POST',
            headers: { 'Authorization': `Bearer ${aliceToken}` }
        }, 'document_test.txt', dummyFileContent, { conversation_id: convId });

        assert(uploadRes.status === 201, `Upload pièce jointe réussi (status 201, got ${uploadRes.status})`);
        const attachmentId = uploadRes.data ? uploadRes.data.id : null;
        assert(attachmentId && uploadRes.data.original_name === 'document_test.txt', `Métadonnées pièce jointe valides (${uploadRes.data ? uploadRes.data.original_name : 'null'})`);

        // Envoi d'un message avec la pièce jointe attachée
        const msgWithAtt = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: `/conversations/${convId}/messages`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aliceToken}`
            }
        }, {
            content: 'Voici le document joint !',
            attachmentId: attachmentId
        });
        assert(msgWithAtt.status === 201, `Message avec pièce jointe créé (status 201)`);
        assert(msgWithAtt.data && msgWithAtt.data.attachment_id === attachmentId, `Liaison attachment_id confirmée sur le message`);

        // Téléchargement sécurisé par le destinataire (Bob)
        const downloadBob = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: `/attachments/${attachmentId}/download?token=${bobToken}`,
            method: 'GET'
        });
        assert(downloadBob.status === 200, `Bob peut télécharger la pièce jointe (status 200)`);
        assert(downloadBob.rawBody === dummyFileContent.toString(), `Contenu du fichier téléchargé intègre`);

        // Téléchargement refusé pour un utilisateur tiers non-participant (Charlie)
        const charlieUser = `charlie_${testSuffix}`;
        const regCharlie = await request({
            hostname: '127.0.0.1',
            port: 3000,
            path: '/register',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { username: charlieUser, password });
        const charlieToken = regCharlie.data ? regCharlie.data.token : null;

        if (charlieToken) {
            const downloadCharlie = await request({
                hostname: '127.0.0.1',
                port: 3000,
                path: `/attachments/${attachmentId}/download?token=${charlieToken}`,
                method: 'GET'
            });
            assert(downloadCharlie.status === 403, `Accès refusé pour Charlie tiers non participant (status 403, got ${downloadCharlie.status})`);
        }

    } catch (e) {
        console.error('Erreur inattendue pendant les tests :', e);
        failed++;
    }

    console.log(`\n========================================`);
    console.log(`RESULTATS : ${passed} passés, ${failed} échoués`);
    console.log(`========================================`);

    process.exit(failed > 0 ? 1 : 0);
}

runTests();

