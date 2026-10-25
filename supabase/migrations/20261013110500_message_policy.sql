-- Policies sur les messages
-- Un utilisateur est « concerné » par un message lorsque celui-ci appartient
-- à une conversation rattachée à l'un de ses objectifs
-- (message -> conversation -> objective -> user_id).

-- Lecture : l'utilisateur peut lire TOUS les messages de ses conversations,
-- y compris ceux envoyés par l'IA (aucun filtre sur le champ sender).
create policy "Users can view messages of their conversations"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.conversations c
    join public.objectives o on o.id = c.objective_id
    where c.id = messages.conversation_id
      and o.user_id = (select auth.uid())
  )
);

-- Création : l'utilisateur peut créer un message dans une conversation
-- rattachée à l'un de ses objectifs.
create policy "Users can create messages in their conversations"
on public.messages
for insert
to authenticated
with check (
  exists (
    select 1
    from public.conversations c
    join public.objectives o on o.id = c.objective_id
    where c.id = messages.conversation_id
      and o.user_id = (select auth.uid())
  )
);
