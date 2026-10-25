-- Policy de lecture sur les conversations
-- Un utilisateur ne peut consulter que les conversations rattachées à l'un
-- de ses objectifs (conversation -> objective -> user_id).
-- Aucune autre opération n'est autorisée : pas de suppression ni de mise à
-- jour. La création est gérée automatiquement par le trigger
-- auto_create_conversation_on_objective (fonction SECURITY DEFINER qui
-- contourne RLS), donc aucune policy d'insertion n'est nécessaire.
create policy "Users can view conversations of their objectives"
on public.conversations
for select
to authenticated
using (
  exists (
    select 1
    from public.objectives o
    where o.id = conversations.objective_id
      and o.user_id = (select auth.uid())
  )
);
