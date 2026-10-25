-- Turn on RLS (locks the table until policies allow access)
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.objectives enable row level security;
alter table public.tasks enable row level security;

