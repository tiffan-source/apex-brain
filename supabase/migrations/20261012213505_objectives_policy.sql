alter table public.objectives
  alter column user_id type uuid using user_id::uuid;

alter table public.objectives
  add constraint objectives_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

create policy "Users can view their own objectives"
on public.objectives
for select
to authenticated
using ( (select auth.uid()) = user_id );

create policy "Users can create their own objectives"
on public.objectives
for insert
to authenticated
with check ( (select auth.uid()) = user_id );

create policy "Users can update their own objectives"
on public.objectives
for update
to authenticated
using ( (select auth.uid()) = user_id )
with check ( (select auth.uid()) = user_id );

create policy "Users can delete their own objectives"
on public.objectives
for delete
to authenticated
using ( (select auth.uid()) = user_id );
