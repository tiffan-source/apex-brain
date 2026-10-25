
-- 1. Table conversations
-- Une conversation est toujours liée à un seul objectif de haut niveau
CREATE TABLE public.conversations (
  id text NOT NULL,
  objective_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  CONSTRAINT conversations_objective_id_fkey
    FOREIGN KEY (objective_id) REFERENCES public.objectives(id) ON DELETE CASCADE
);

-- 2. Table messages
CREATE TABLE public.messages (
  id text NOT NULL,
  conversation_id text NOT NULL,
  sender text NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE
);

-- 3. Indexes pour les performances
CREATE INDEX idx_conversations_objective_id ON public.conversations(objective_id);
CREATE INDEX idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX idx_messages_created_at ON public.messages(created_at);

-- 4. Trigger : garantir qu'une conversation est liée à un objectif SANS parent_id
CREATE OR REPLACE FUNCTION public.check_conversation_objective_top_level()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.objectives
    WHERE id = NEW.objective_id AND parent_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Une conversation doit être liée à un objectif de haut niveau (sans parent_id)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_conversation_top_level_objective
BEFORE INSERT OR UPDATE ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.check_conversation_objective_top_level();
