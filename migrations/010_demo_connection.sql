-- Judge demo connection (SPEC §3b). A project can use Kitpier's demo Supabase project (judges-only org) and a
-- captured-mail inbox instead of its own Supabase and Resend. Real credentials are kept but unused while it's on.
ALTER TABLE projects ADD COLUMN demo_connection boolean NOT NULL DEFAULT false;

-- Emails a demo project would have sent: shown in its Demo inbox, never delivered. Owner-only view.
CREATE TABLE demo_mail (
  id              bigserial PRIMARY KEY,
  project_id      text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id text REFERENCES conversations(id) ON DELETE SET NULL,
  kind            text NOT NULL CHECK (kind IN ('code','confirmation')),
  to_address      text NOT NULL,
  subject         text NOT NULL,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demo_mail_project_idx ON demo_mail(project_id, id);
