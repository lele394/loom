(function () {
  try {
    var saved = JSON.parse(localStorage.getItem('loom-appearance') || '{}');
    var palette = saved.palette || 'lavender';
    var mode = saved.mode || 'system';
    var resolved =
      mode === 'system'
        ? window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : mode;
    var root = document.documentElement;
    root.dataset.theme = palette;
    root.dataset.mode = resolved;
    root.dataset.density = saved.density || 'comfortable';
    if (saved.accent) root.style.setProperty('--accent', saved.accent);
  } catch (error) {
    document.documentElement.dataset.theme = 'lavender';
    document.documentElement.dataset.mode = 'light';
  }
})();
