// Module de mise en forme du texte (Markdown style Discord, sécurité XSS et barre d'options)

/**
 * Assainit le texte brut en échappant les entités HTML pour prévenir toute injection XSS.
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Convertit une chaîne de caractères contenant de la syntaxe Markdown (style Discord)
 * en HTML assaini et stylisé.
 * Supporte :
 *  - Blocs de code (```lang ... ```)
 *  - Code en ligne (`code`)
 *  - Spoilers (||secret||)
 *  - Citations (> texte)
 *  - Gras (***gras italique***, **gras**)
 *  - Italique (*italique*, _italique_)
 *  - Barré (~~barré~~)
 *  - Liens web automatiques (https://...)
 *
 * @param {string} text
 * @returns {string}
 */
export function parseMarkdown(text) {
    if (!text) return "";

    // Préserve les messages d'état système de PVCHAT sans les altérer
    if (text.startsWith("🔒 [") || text.startsWith("⚠️ [")) {
        return escapeHtml(text);
    }

    // Étape 1 : Échappement complet pour la sécurité XSS
    let escaped = escapeHtml(text);

    // Étape 2 : Extraction et tokenisation des blocs de code multi-lignes
    const codeBlocks = [];
    escaped = escaped.replace(/```(?:([a-zA-Z0-9_+-]+)?(?:\r?\n))?([\s\S]*?)```/g, (match, lang, code) => {
        const id = codeBlocks.length;
        const cleanCode = (code || "").replace(/^\r?\n|\r?\n$/g, "");
        codeBlocks.push({ lang: (lang || "").trim(), code: cleanCode });
        return `%%PV_CODE_BLOCK_${id}%%`;
    });

    // Étape 3 : Extraction et tokenisation du code en ligne
    const inlineCodes = [];
    escaped = escaped.replace(/`([^`\r\n]+)`/g, (match, code) => {
        const id = inlineCodes.length;
        inlineCodes.push(code);
        return `%%PV_INLINE_CODE_${id}%%`;
    });

    // Étape 4 : Spoilers façon Discord (||secret||)
    escaped = escaped.replace(
        /\|\|([\s\S]+?)\|\|/g,
        '<span class="chat-spoiler" role="button" tabindex="0" title="Cliquer pour afficher">$1</span>'
    );

    // Étape 5 : Citations (> citation) regroupées
    const lines = escaped.split(/\r?\n/);
    const resultLines = [];
    let inQuote = false;
    let quoteLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const quoteMatch = line.match(/^&gt;\s?(.*)$/);
        if (quoteMatch) {
            inQuote = true;
            quoteLines.push(quoteMatch[1]);
        } else {
            if (inQuote) {
                resultLines.push(`<blockquote class="chat-quote">${quoteLines.join("<br>")}</blockquote>`);
                quoteLines = [];
                inQuote = false;
            }
            resultLines.push(line);
        }
    }
    if (inQuote) {
        resultLines.push(`<blockquote class="chat-quote">${quoteLines.join("<br>")}</blockquote>`);
    }
    escaped = resultLines.join("\n");

    // Étape 6 : Gras, Italique, Barré
    escaped = escaped.replace(/\*\*\*([^\*\n]+?)\*\*\*/g, "<strong><em>$1</em></strong>");
    escaped = escaped.replace(/\*\*([^\*\n]+?)\*\*/g, "<strong>$1</strong>");
    escaped = escaped.replace(/\*([^\*\n]+?)\*/g, "<em>$1</em>");
    escaped = escaped.replace(/(^|[\s.,!?;:()\[\]])_([^_\n]+?)_($|[\s.,!?;:()\[\]])/g, "$1<em>$2</em>$3");
    escaped = escaped.replace(/~~([^~\n]+?)~~/g, "<del>$1</del>");

    // Étape 7 : Liens web automatiques
    escaped = escaped.replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" class="chat-link">$1</a>'
    );

    // Étape 8 : Retours à la ligne
    escaped = escaped.replace(/\r?\n/g, "<br>");

    // Étape 9 : Réinjection du code en ligne
    escaped = escaped.replace(/%%PV_INLINE_CODE_(\d+)%%/g, (match, idx) => {
        const item = inlineCodes[Number(idx)];
        return `<code class="chat-inline-code">${item}</code>`;
    });

    // Étape 10 : Réinjection des blocs de code avec bouton de copie
    escaped = escaped.replace(/%%PV_CODE_BLOCK_(\d+)%%/g, (match, idx) => {
        const item = codeBlocks[Number(idx)];
        const langStr = item.lang ? `<span class="chat-code-lang">${item.lang}</span>` : "";
        return `<div class="code-block-wrapper"><div class="code-block-header">${langStr}<button type="button" class="copy-code-btn" title="Copier le code">Copier 📋</button></div><pre class="code-block"><code class="code-block-content">${item.code}</code></pre></div>`;
    });

    return escaped;
}

/**
 * Retire la syntaxe Markdown pour obtenir un aperçu lisible en texte brut
 * (utilisé dans la liste des conversations).
 * @param {string} text
 * @returns {string}
 */
export function stripMarkdown(text) {
    if (!text) return "";
    return text
        .replace(/```(?:[a-zA-Z0-9_+-]+)?\r?\n?([\s\S]*?)```/g, "$1")
        .replace(/`([^`\r\n]+)`/g, "$1")
        .replace(/\*\*\*([^\*\n]+?)\*\*\*/g, "$1")
        .replace(/\*\*([^\*\n]+?)\*\*/g, "$1")
        .replace(/\*([^\*\n]+?)\*/g, "$1")
        .replace(/(^|[\s.,!?;:()\[\]])_([^_\n]+?)_($|[\s.,!?;:()\[\]])/g, "$1$2$3")
        .replace(/~~([^~\n]+?)~~/g, "$1")
        .replace(/\|\|([\s\S]+?)\|\|/g, "[Spoiler]")
        .replace(/^>\s?/gm, "")
        .replace(/\r?\n/g, " ")
        .trim();
}

/**
 * Applique une mise en forme dans le textarea en fonction de la sélection du curseur.
 * Si du texte est sélectionné, il est enveloppé par les symboles.
 * Si rien n'est sélectionné, les symboles sont insérés avec le curseur positionné au milieu.
 * @param {HTMLTextAreaElement} textarea
 * @param {string} formatType
 */
export function applyFormat(textarea, formatType) {
    if (!textarea) textarea = document.getElementById("messageInput");
    if (!textarea) return;

    if (textarea.disabled) {
        return;
    }

    textarea.focus();

    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const value = textarea.value;
    const selected = value.substring(start, end);

    let before = "";
    let after = "";

    switch (formatType) {
        case "bold":
            before = "**";
            after = "**";
            break;
        case "italic":
            before = "*";
            after = "*";
            break;
        case "strike":
            before = "~~";
            after = "~~";
            break;
        case "inline-code":
            before = "`";
            after = "`";
            break;
        case "code-block":
            if (selected.includes("\n") || selected.length > 0) {
                before = "```\n";
                after = "\n```";
            } else {
                before = "```\n";
                after = "\n```";
            }
            break;
        case "quote":
            if (selected.length > 0) {
                const formatted = selected
                    .split("\n")
                    .map(l => (l.startsWith("> ") ? l : `> ${l}`))
                    .join("\n");
                if (typeof textarea.setRangeText === "function") {
                    textarea.setRangeText(formatted, start, end, "select");
                } else {
                    textarea.value = value.substring(0, start) + formatted + value.substring(end);
                    textarea.setSelectionRange(start, start + formatted.length);
                }
                textarea.dispatchEvent(new Event("input", { bubbles: true }));
                textarea.focus();
                return;
            } else {
                before = "> ";
                after = "";
            }
            break;
        case "spoiler":
            before = "||";
            after = "||";
            break;
        default:
            return;
    }

    if (selected.length > 0) {
        const replacement = before + selected + after;
        if (typeof textarea.setRangeText === "function") {
            textarea.setRangeText(replacement, start, end, "select");
            textarea.setSelectionRange(start + before.length, end + before.length);
        } else {
            textarea.value = value.substring(0, start) + replacement + value.substring(end);
            textarea.setSelectionRange(start + before.length, end + before.length);
        }
    } else {
        const insertText = before + after;
        if (typeof textarea.setRangeText === "function") {
            textarea.setRangeText(insertText, start, end, "end");
        } else {
            textarea.value = value.substring(0, start) + insertText + value.substring(end);
        }
        const newCursorPos = start + before.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
    }

    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    syncInputHighlights(textarea);
    textarea.focus();
}

/**
 * Met en valeur la syntaxe Markdown directement dans l'input (gras, italique, barré, code inline, spoiler).
 * Ne transforme pas les blocs de code complexes pour laisser la saisie fluide.
 * @param {string} text
 * @returns {string}
 */
export function highlightInput(text) {
    if (!text) return "";
    let escaped = escapeHtml(text);

    const tokens = [];

    // Code inline `code`
    escaped = escaped.replace(/`([^`\r\n]+)`/g, (m, c) => {
        tokens.push(`<span class="hl-marker">\`</span><code class="hl-code">${c}</code><span class="hl-marker">\`</span>`);
        return `\x00${tokens.length - 1}\x00`;
    });

    // Spoilers ||secret||
    escaped = escaped.replace(/\|\|([^|\r\n]+)\|\|/g, (m, c) => {
        tokens.push(`<span class="hl-marker">||</span><span class="hl-spoiler">${c}</span><span class="hl-marker">||</span>`);
        return `\x00${tokens.length - 1}\x00`;
    });

    // Gras + Italique ***texte***
    escaped = escaped.replace(/\*\*\*([^*\r\n]+)\*\*\*/g, (m, c) => {
        tokens.push(`<span class="hl-marker">***</span><strong class="hl-bold"><em class="hl-italic">${c}</em></strong><span class="hl-marker">***</span>`);
        return `\x00${tokens.length - 1}\x00`;
    });

    // Gras **texte**
    escaped = escaped.replace(/\*\*([^*\r\n]+)\*\*/g, (m, c) => {
        tokens.push(`<span class="hl-marker">**</span><strong class="hl-bold">${c}</strong><span class="hl-marker">**</span>`);
        return `\x00${tokens.length - 1}\x00`;
    });

    // Italique *texte*
    escaped = escaped.replace(/\*([^*\r\n]+)\*/g, (m, c) => {
        tokens.push(`<span class="hl-marker">*</span><em class="hl-italic">${c}</em><span class="hl-marker">*</span>`);
        return `\x00${tokens.length - 1}\x00`;
    });

    // Barré ~~texte~~
    escaped = escaped.replace(/~~([^~\r\n]+)~~/g, (m, c) => {
        tokens.push(`<span class="hl-marker">~~</span><del class="hl-strike">${c}</del><span class="hl-marker">~~</span>`);
        return `\x00${tokens.length - 1}\x00`;
    });

    // Réinjection des tokens
    escaped = escaped.replace(/\x00(\d+)\x00/g, (m, idx) => tokens[Number(idx)]);

    if (text.endsWith("\n")) {
        escaped += " ";
    }

    return escaped;
}

/**
 * Synchronise le texte stylisé en arrière-plan de l'input et son défilement.
 * @param {HTMLTextAreaElement} [textarea]
 */
export function syncInputHighlights(textarea) {
    if (!textarea) textarea = document.getElementById("messageInput");
    const highlights = document.getElementById("inputHighlights");
    const backdrop = document.getElementById("inputBackdrop");
    if (!textarea || !highlights) return;

    highlights.innerHTML = highlightInput(textarea.value);
    if (backdrop) {
        backdrop.scrollTop = textarea.scrollTop;
    }
}

/**
 * Active ou désactive visuellement et fonctionnellement les boutons de la barre d'outils.
 * @param {boolean} disabled
 */
export function updateToolbarDisabledState(disabled) {
    const toolbar = document.getElementById("composerToolbar");
    if (!toolbar) return;
    const buttons = toolbar.querySelectorAll(".toolbar-btn");
    buttons.forEach(btn => {
        btn.disabled = disabled;
    });
    if (disabled) {
        toolbar.classList.add("disabled");
    } else {
        toolbar.classList.remove("disabled");
    }
}

/**
 * Initialise les boutons de la barre d'outils avec délégation d'événements.
 * @param {HTMLTextAreaElement} [textarea]
 */
export function initFormatToolbar(textarea) {
    const toolbar = document.getElementById("composerToolbar");
    if (!toolbar) return;

    const input = textarea || document.getElementById("messageInput");
    if (input && !input._hasHighlightListener) {
        input._hasHighlightListener = true;
        input.addEventListener("input", () => {
            syncInputHighlights(input);
        });
        input.addEventListener("scroll", () => {
            const backdrop = document.getElementById("inputBackdrop");
            if (backdrop) backdrop.scrollTop = input.scrollTop;
        });
        syncInputHighlights(input);
    }

    if (toolbar._hasToolbarListeners) return;
    toolbar._hasToolbarListeners = true;

    // Empêche la perte de focus du textarea lors du clic
    toolbar.addEventListener("mousedown", (e) => {
        const btn = e.target.closest(".toolbar-btn");
        if (btn) {
            e.preventDefault();
        }
    });

    // Clic sur l'un des boutons de la barre
    toolbar.addEventListener("click", (e) => {
        const btn = e.target.closest(".toolbar-btn");
        if (!btn) return;

        e.preventDefault();

        const targetInput = textarea || document.getElementById("messageInput");
        if (!targetInput) return;

        if (targetInput.disabled) {
            return;
        }

        const format = btn.dataset.format;
        if (format) {
            applyFormat(targetInput, format);
        }
    });
}

/**
 * Configure les interactions utilisateur pour les spoilers et la copie de code
 * via délégation d'événements sur le conteneur des messages.
 * @param {HTMLElement} messagesContainer
 */
export function setupMessageInteractions(messagesContainer) {
    if (!messagesContainer || messagesContainer._hasInteractionListeners) return;
    messagesContainer._hasInteractionListeners = true;

    // Gestion du clic
    messagesContainer.addEventListener("click", async (e) => {
        // Clic sur un spoiler
        const spoiler = e.target.closest(".chat-spoiler");
        if (spoiler) {
            spoiler.classList.toggle("revealed");
            return;
        }

        // Clic sur le bouton copier d'un bloc de code
        const copyBtn = e.target.closest(".copy-code-btn");
        if (copyBtn) {
            const wrapper = copyBtn.closest(".code-block-wrapper");
            const codeEl = wrapper ? wrapper.querySelector(".code-block-content") : null;
            if (!codeEl) return;

            const textToCopy = codeEl.innerText || codeEl.textContent;
            try {
                await navigator.clipboard.writeText(textToCopy);
                const originalHtml = copyBtn.innerHTML;
                copyBtn.innerHTML = "Copié ! ✅";
                copyBtn.classList.add("copied");
                setTimeout(() => {
                    copyBtn.innerHTML = originalHtml;
                    copyBtn.classList.remove("copied");
                }, 2000);
            } catch (err) {
                console.warn("Impossible de copier dans le presse-papier :", err);
            }
        }
    });

    // Accessibilité clavier pour les spoilers (Touche Entrée ou Espace)
    messagesContainer.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            const spoiler = e.target.closest(".chat-spoiler");
            if (spoiler) {
                e.preventDefault();
                spoiler.classList.toggle("revealed");
            }
        }
    });
}
