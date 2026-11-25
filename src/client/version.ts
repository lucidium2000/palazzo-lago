declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

/** This build's version (the commit count, so it goes up with every change) and its commit. */
export const VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : '';

/** Shows the version in the top-right corner (and in the page title's tooltip). */
export function showVersion() {
  const el = document.getElementById('version');
  if (el) {
    el.textContent = VERSION;
    el.title = `Palazzo Lago ${VERSION}${COMMIT ? ` (${COMMIT})` : ''}`;
  }
}
