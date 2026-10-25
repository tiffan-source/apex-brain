-- 1. Suppression temporaire des clés étrangères
ALTER TABLE tasks
    DROP CONSTRAINT IF EXISTS tasks_objective_id_fkey;

ALTER TABLE objectives
    DROP CONSTRAINT IF EXISTS objectives_parent_id_fkey;

-- 2. Modification des types de colonnes vers TEXT
ALTER TABLE objectives
    ALTER COLUMN id TYPE TEXT USING id::text,
    ALTER COLUMN parent_id TYPE TEXT USING parent_id::text;

ALTER TABLE tasks
    ALTER COLUMN id TYPE TEXT USING id::text,
    ALTER COLUMN objective_id TYPE TEXT USING objective_id::text;

-- 3. Réapplication des clés étrangères
ALTER TABLE objectives
    ADD CONSTRAINT objectives_parent_id_fkey
    FOREIGN KEY (parent_id) REFERENCES objectives(id) ON DELETE CASCADE;

ALTER TABLE tasks
    ADD CONSTRAINT tasks_objective_id_fkey
    FOREIGN KEY (objective_id) REFERENCES objectives(id) ON DELETE CASCADE;
