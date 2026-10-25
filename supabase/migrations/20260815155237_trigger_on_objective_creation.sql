CREATE OR REPLACE FUNCTION public.auto_create_conversation_on_objective()
RETURNS TRIGGER AS $$
BEGIN
  -- Seuls les objectifs sans parent_id déclenchent la création
  IF NEW.parent_id IS NULL THEN
    INSERT INTO public.conversations (id, objective_id, created_at)
    VALUES (gen_random_uuid()::text, NEW.id, now());
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Trigger AFTER INSERT sur la table objectives
-- FOR EACH ROW permet d'accéder à NEW.id et NEW.parent_id
CREATE TRIGGER trg_auto_create_conversation_on_objective
AFTER INSERT ON public.objectives
FOR EACH ROW
EXECUTE FUNCTION public.auto_create_conversation_on_objective();
