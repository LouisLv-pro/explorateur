//! Requêtes SQL de la table `recent_folders`.

use crate::Result;
use crate::db::Db;

/// Place `path` en tête des récents (rang le plus haut), puis ne garde que les `keep` premiers.
pub async fn touch(db: &Db, path: &str, keep: i64) -> Result<()> {
    let mut tx = db.begin().await?;
    sqlx::query(
        "INSERT INTO recent_folders (path, rank)
         VALUES (?, (SELECT COALESCE(MAX(rank), 0) + 1 FROM recent_folders))
         ON CONFLICT (path) DO UPDATE SET rank = excluded.rank",
    )
    .bind(path)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM recent_folders
         WHERE path NOT IN (SELECT path FROM recent_folders ORDER BY rank DESC LIMIT ?)",
    )
    .bind(keep)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Chemins des récents, du plus récent au plus ancien.
pub async fn list(db: &Db, limit: i64) -> Result<Vec<String>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT path FROM recent_folders ORDER BY rank DESC LIMIT ?")
            .bind(limit)
            .fetch_all(db)
            .await?;
    Ok(rows.into_iter().map(|(p,)| p).collect())
}

pub async fn remove(db: &Db, path: &str) -> Result<()> {
    sqlx::query("DELETE FROM recent_folders WHERE path = ?")
        .bind(path)
        .execute(db)
        .await?;
    Ok(())
}
