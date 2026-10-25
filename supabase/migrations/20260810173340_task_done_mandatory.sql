-- 1. Mise à jour des valeurs existantes si la colonne contenait des NULL
UPDATE tasks
SET done = FALSE
WHERE done IS NULL;

-- 2. Modification de la colonne pour ajouter la contrainte NOT NULL et définir la valeur par défaut
ALTER TABLE tasks
    ALTER COLUMN done SET DEFAULT FALSE,
    ALTER COLUMN done SET NOT NULL;
