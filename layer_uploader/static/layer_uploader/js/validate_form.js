(function () {
  var form = document.getElementById('lu-validate-form');
  var overlay = document.getElementById('lu-validate-overlay');
  if (!form || !overlay) {
    return;
  }

  form.addEventListener('submit', function () {
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lu-validate-overlay-open');
    form.setAttribute('aria-busy', 'true');
    form.querySelectorAll('button, a, input, select, textarea').forEach(function (el) {
      el.setAttribute('aria-disabled', 'true');
      if (el.tagName === 'BUTTON') {
        el.disabled = true;
      }
      if (el.tagName === 'A') {
        el.style.pointerEvents = 'none';
        el.tabIndex = -1;
      }
    });
  });
})();
