//! Échappement d'un chemin pour le shell (glisser une entrée de l'arborescence sur le terminal).

/// Chemin écrit tel quel s'il ne contient que des caractères sûrs pour `sh`, `bash` et `zsh` :
/// lettres et chiffres (accents compris, laissés tels quels), `/ . _ - + , @ %`. Sinon (espace,
/// apostrophe, guillemet, `$`, `!`, `*`, `~`, `=`, retour à la ligne, chaîne vide…) entouré
/// d'apostrophes, chaque apostrophe devenant `'\''`.
///
/// Recollé dans une commande, le résultat redonne exactement `path`.
pub fn shell_quote(path: &str) -> String {
    let safe = |c: char| c.is_alphanumeric() || "/._-+,@%".contains(c);
    if !path.is_empty() && path.chars().all(safe) {
        return path.to_owned();
    }
    format!("'{}'", path.replace('\'', r"'\''"))
}
