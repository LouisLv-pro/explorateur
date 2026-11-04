// Pas de fenêtre console sous Windows en release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(err) = explorateur_lib::run() {
        eprintln!("erreur fatale : {err}");
        std::process::exit(1);
    }
}
