use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};

use crate::Result;

/// Pool de connexions SQLite, stocké dans l'état de l'app Tauri.
pub type Db = SqlitePool;

/// Ouvre (ou crée) la base de l'app et applique les migrations de `migrations/`.
pub async fn open(path: &Path) -> Result<SqlitePool> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new().connect_with(options).await?;
    sqlx::migrate!().run(&pool).await?;
    Ok(pool)
}

/// Base en mémoire pour les tests, avec les mêmes migrations que la vraie.
pub async fn in_memory() -> Result<SqlitePool> {
    // Une seule connexion : chaque connexion `:memory:` aurait sa propre base vide.
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;
    sqlx::migrate!().run(&pool).await?;
    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn la_base_est_creee_sur_disque_puis_rouverte() {
        let dir = std::env::temp_dir().join(format!("core-db-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("app.db");

        open(&path).await.unwrap().close().await;
        assert!(path.exists());
        open(&path).await.unwrap().close().await;

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn la_base_en_memoire_accepte_des_requetes() {
        let pool = in_memory().await.unwrap();
        let (one,): (i64,) = sqlx::query_as("SELECT 1").fetch_one(&pool).await.unwrap();
        assert_eq!(one, 1);
    }
}
