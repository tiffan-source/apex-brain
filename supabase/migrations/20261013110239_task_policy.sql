alter table public.tasks
  alter column user_id type uuid using user_id::uuid;

alter table public.tasks
  add constraint tasks_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

create policy "Users can view their own tasks"
on public.tasks
for select
to authenticated
using ( (select auth.uid()) = user_id );

create policy "Users can create their own tasks"
on public.tasks
for insert
to authenticated
with check ( (select auth.uid()) = user_id );

create policy "Users can update their own tasks"
on public.tasks
for update
to authenticated
using ( (select auth.uid()) = user_id )
with check ( (select auth.uid()) = user_id );

create policy "Users can delete their own tasks"
on public.tasks
for delete
to authenticated
using ( (select auth.uid()) = user_id );
