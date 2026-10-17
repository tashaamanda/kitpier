-- Recovery scene (SPEC §3.6): when booking pauses, the planner proposes a top-up card; the user pays via PayPal.
-- The planner only proposes. The pack and the budget raise come from the server, applied when the capture is credited.
CREATE TABLE top_up_proposals (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pack_id     text NOT NULL CHECK (pack_id IN ('p10','p25','p50')),
  status      text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','paid','superseded')),
  order_id    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE INDEX top_up_proposals_project_idx ON top_up_proposals(project_id);

ALTER TABLE orders
  ADD COLUMN top_up_id text REFERENCES top_up_proposals(id),
  ADD COLUMN budget_raise_micros bigint NOT NULL DEFAULT 0 CHECK (budget_raise_micros >= 0);
