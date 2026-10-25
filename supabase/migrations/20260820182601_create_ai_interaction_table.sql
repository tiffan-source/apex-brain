CREATE TABLE public.ai_interactions (
  id text NOT NULL,
  conversation_id text NOT NULL,
  provider text NOT NULL,
  provider_interaction_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT ai_interactions_pkey PRIMARY KEY (id),

  CONSTRAINT ai_interactions_conversation_id_fkey
    FOREIGN KEY (conversation_id)
    REFERENCES public.conversations(id),

  CONSTRAINT ai_interactions_conversation_id_unique
    UNIQUE (conversation_id)
);
