-- Suppression de la table ai_interactions, devenue inutile.
-- Aucun autre objet ne dépend de cette table (elle référence conversations
-- mais rien ne la référence), un simple drop suffit donc.
drop table if exists public.ai_interactions;
