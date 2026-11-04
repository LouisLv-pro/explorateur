/**
 * Vrai si le focus est dans la page du navigateur : la webview enfant est affichée et le
 * document de l'app, lui, n'a plus le focus (la fenêtre est pourtant active, puisque l'appelant
 * traite une entrée du menu natif). ⌘W ferme alors l'onglet du navigateur.
 */
export function isInBrowserPage(): boolean {
  const area = document.querySelector<HTMLElement>("[data-browser-area]");
  return area !== null && area.getClientRects().length > 0 && !document.hasFocus();
}
