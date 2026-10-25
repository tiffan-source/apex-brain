create table if not exists objectives (
  id bigint primary key,
  title text not null,
  description text,
  created_at timestamptz default now()
);
