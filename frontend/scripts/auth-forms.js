// Gestion des formulaires d'authentification (connexion et inscription)

function showAuthMessage(element, text, isError) {
    if (!element) return;
    element.textContent = text;
    element.className = "form-message " + (isError ? "form-message-error" : "form-message-success");
    element.hidden = false;
}

// Initialisation du formulaire de connexion
export function initLoginForm() {
    const form = document.getElementById("login-form");
    const formMessage = document.getElementById("formMessage");
    const submitBtn = document.getElementById("submitBtn");

    if (!form) return;

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const usernameInput = document.getElementById("username");
        const passwordInput = document.getElementById("password");
        const username = usernameInput ? usernameInput.value.trim() : "";
        const password = passwordInput ? passwordInput.value : "";

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Connexion...";
        }

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                localStorage.setItem('pvchat_token', data.token);
                localStorage.setItem('pvchat_username', data.user.username);
                if (data.user && (data.user.id || data.user.userId)) {
                    localStorage.setItem('pvchat_user_id', data.user.id || data.user.userId);
                }
                showAuthMessage(formMessage, "Connexion réussie ! Redirection...", false);
                setTimeout(() => window.location.href = "index.html", 600);
            } else {
                showAuthMessage(formMessage, data.error || "Identifiants incorrects.", true);
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Se connecter";
                }
            }
        } catch {
            showAuthMessage(formMessage, "Impossible de contacter le serveur. Vérifiez votre connexion.", true);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = "Se connecter";
            }
        }
    });
}

// Initialisation du formulaire d'inscription
export function initRegisterForm() {
    const form = document.getElementById("register-form");
    const formMessage = document.getElementById("formMessage");
    const submitBtn = document.getElementById("submitBtn");

    if (!form) return;

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const usernameInput = document.getElementById("username");
        const passwordInput = document.getElementById("password");
        const confirmInput = document.getElementById("confirm-password");

        const username = usernameInput ? usernameInput.value.trim() : "";
        const password = passwordInput ? passwordInput.value : "";
        const confirmation = confirmInput ? confirmInput.value : "";

        if (!username) {
            showAuthMessage(formMessage, "Veuillez entrer un nom d'utilisateur.", true);
            return;
        }

        if (password !== confirmation) {
            showAuthMessage(formMessage, "Les mots de passe ne correspondent pas.", true);
            return;
        }

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Création en cours...";
        }

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                showAuthMessage(formMessage, "Compte créé ! Redirection vers la connexion...", false);
                setTimeout(() => window.location.href = "login.html", 1200);
            } else {
                showAuthMessage(formMessage, data.error || "Erreur lors de l'inscription.", true);
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Créer mon compte";
                }
            }
        } catch {
            showAuthMessage(formMessage, "Impossible de contacter le serveur. Vérifiez votre connexion.", true);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = "Créer mon compte";
            }
        }
    });
}
