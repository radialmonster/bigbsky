// Boot failure detector (external so it stays allowed under the site's
// Content-Security-Policy without a hash or nonce — it must run even when the
// app bundle itself is blocked). If the app entry never mounts (bundle fails to
// load, a syntax/CSP error, or a broken deploy), replace the loading spinner
// with an actionable error instead of leaving the reader on a blank page
// forever. React removes #app-loading when it renders into #root, so its
// continued presence after the timeout means the app did not boot.
(function () {
  "use strict";
  var TIMEOUT_MS = 15000;
  window.setTimeout(function () {
    var loading = document.getElementById("app-loading");
    if (!loading) {
      return; // React mounted and replaced it — all good.
    }
    loading.setAttribute("role", "alert");

    // Derive the app base directory from this script's own URL so the
    // "Go to home" link stays correct on a base/subdirectory deploy.
    var scriptUrl = document.currentScript ? document.currentScript.src : location.href;
    var basePath = new URL(".", scriptUrl).pathname;

    var title = document.createElement("p");
    title.className = "app-boot-title";
    title.textContent = "BigBsky failed to load";

    var text = document.createElement("p");
    text.className = "app-boot-text";
    text.textContent =
      "The app could not start. This is usually a network hiccup or a stale cache. Reloading often fixes it.";

    var actions = document.createElement("div");
    actions.className = "app-boot-actions";

    var reload = document.createElement("button");
    reload.type = "button";
    reload.className = "app-boot-btn";
    reload.textContent = "Reload";
    reload.addEventListener("click", function () {
      window.location.reload();
    });

    var home = document.createElement("a");
    home.className = "app-boot-btn secondary";
    home.href = basePath;
    home.textContent = "Go to home";

    actions.appendChild(reload);
    actions.appendChild(home);

    loading.innerHTML = "";
    loading.appendChild(title);
    loading.appendChild(text);
    loading.appendChild(actions);
  }, TIMEOUT_MS);
})();
