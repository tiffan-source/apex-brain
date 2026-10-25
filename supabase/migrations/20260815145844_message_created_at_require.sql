UPDATE public.messages
SET created_at = now()
WHERE created_at IS NULL;

-- 2. Ajouter la contrainte NOT NULL
ALTER TABLE public.messages
ALTER COLUMN created_at SET NOT NULL;

-- 3. S'assurer que la valeur par défaut est bien définie
-- (déjà présente dans la migration précédente, mais on renforce ici)
ALTER TABLE public.messages
ALTER COLUMN created_at SET DEFAULT now();
