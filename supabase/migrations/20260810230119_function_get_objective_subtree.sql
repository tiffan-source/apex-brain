CREATE OR REPLACE FUNCTION get_objective_subtree(p_id TEXT)
RETURNS SETOF objectives AS $$
WITH RECURSIVE subtree AS (
    -- Cas de base : l'objectif recherché
    SELECT * FROM objectives WHERE id = p_id

    UNION ALL

    -- Cas récursif : tous ses sous-objectifs direct et indirects
    SELECT o.* FROM objectives o
    JOIN subtree st ON o.parent_id = st.id
)
SELECT * FROM subtree;
$$ LANGUAGE sql STABLE;
