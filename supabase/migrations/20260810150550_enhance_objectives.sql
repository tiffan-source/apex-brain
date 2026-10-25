-- 1. Mise à jour de la table existante 'objectives'
ALTER TABLE objectives
    ADD COLUMN user_id VARCHAR(255) NOT NULL,
    ADD COLUMN done BOOLEAN DEFAULT FALSE,
    ADD COLUMN due_date TIMESTAMPTZ,
    ADD COLUMN why TEXT,
    ADD COLUMN parent_id BIGINT REFERENCES objectives(id) ON DELETE CASCADE;

-- 2. Création de la table 'tasks'
CREATE TABLE IF NOT EXISTS tasks (
    id BIGINT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    done BOOLEAN DEFAULT FALSE,
    due_date TIMESTAMPTZ,
    importance INT NOT NULL,
    urgency INT NOT NULL,

    -- Clé étrangère vers la table objectives
    objective_id BIGINT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Création des index pour optimiser les lectures
CREATE INDEX IF NOT EXISTS idx_objectives_user ON objectives(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_objective ON tasks(objective_id);
