-- Dossiers racines déjà ouverts. `rank` croît à chaque ouverture : le plus grand est le plus récent.
CREATE TABLE recent_folders (
    path TEXT PRIMARY KEY NOT NULL,
    rank INTEGER NOT NULL
);
