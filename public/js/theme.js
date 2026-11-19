// Applied before first paint to avoid a light/dark flash.
try {
  var t = localStorage.getItem('mca_theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.setAttribute('data-theme', 'dark');
} catch (e) {}
