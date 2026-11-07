/**
 * What's New banner for the current product version.
 * - Auto-shows once per version (localStorage)
 * - Reopens from [data-whats-new-open] (profile version row)
 * - Dismisses only via the Got it action (intentional acknowledge)
 * Banner image language is selected server-side from the active UI language.
 */
(function () {
    var root = document.getElementById("geotrakWhatsNew");
    if (!root) {
        return;
    }

    var version = (root.getAttribute("data-version") || "").trim();
    if (!version) {
        return;
    }

    var storageKey = "geotrak.whatsNew.seenVersion";
    var openClass = "is-open";
    var bodyClass = "geotrak-whats-new-open";
    var dismissBtn = root.querySelector("[data-whats-new-dismiss]");
    var previouslyFocused = null;
    var isOpen = false;

    function hasSeenCurrentVersion() {
        try {
            return window.localStorage.getItem(storageKey) === version;
        } catch (err) {
            return false;
        }
    }

    function markSeen() {
        try {
            window.localStorage.setItem(storageKey, version);
        } catch (err) {
            // Ignore storage failures.
        }
    }

    function closeUserMenu() {
        var menu = document.getElementById("userMenu");
        var icon = document.getElementById("userMenuIcon");
        if (menu) {
            menu.classList.add("hidden");
        }
        if (icon) {
            icon.classList.remove("rotate-180");
        }
    }

    function dismiss() {
        if (!isOpen) {
            return;
        }
        markSeen();
        isOpen = false;
        root.classList.remove(openClass);
        root.setAttribute("hidden", "");
        root.setAttribute("aria-hidden", "true");
        document.body.classList.remove(bodyClass);
        if (previouslyFocused && typeof previouslyFocused.focus === "function") {
            previouslyFocused.focus();
        }
    }

    function open(fromMenu) {
        if (isOpen) {
            return;
        }
        if (fromMenu) {
            closeUserMenu();
        }
        previouslyFocused = document.activeElement;
        isOpen = true;
        root.removeAttribute("hidden");
        root.setAttribute("aria-hidden", "false");
        document.body.classList.add(bodyClass);
        window.requestAnimationFrame(function () {
            root.classList.add(openClass);
            if (dismissBtn && typeof dismissBtn.focus === "function") {
                dismissBtn.focus();
            }
        });
    }

    if (dismissBtn) {
        dismissBtn.addEventListener("click", dismiss);
    }

    document.addEventListener("click", function (event) {
        var trigger = event.target.closest("[data-whats-new-open]");
        if (!trigger) {
            return;
        }
        event.preventDefault();
        open(true);
    });

    if (!hasSeenCurrentVersion()) {
        window.setTimeout(function () {
            open(false);
        }, 280);
    }
})();
