/*
 * Applies the saved theme before the first paint so a dark-mode user never
 * sees a white flash. Logic mirrors themeIsDark() in App.jsx.
 * Default = light; "dark"/"system" saved choices are honoured.
 * Kept as an external file (not inline) so the app can ship a strict CSP.
 */
(function () {
  try {
    var theme = localStorage.getItem('gx-theme') || 'light';
    var dark = theme === 'dark'
      || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
    document.documentElement.dataset.theme = theme;
  } catch (e) {
    /* localStorage unavailable — stay in light mode */
  }
})();
