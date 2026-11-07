# Product Log

Run `npm ci` and `npm run dev`, then open `http://localhost:3000`. Without Supabase credentials, Product Log opens a standalone report board. You can add reports, mark them done or reopen them, and filter the list. Reports are stored in the current browser.

When both Supabase environment variables are configured, the same board requires sign-in and stores reports, report types, and attachments in Supabase. The browser-local board and the shared board have separate data.

Product Log is an internal workspace at `/`. It runs as its own Next.js app with a dedicated Supabase project. Postgres row-level security scopes reads and mutations to the signed-in user, workspace role, and application membership. Bug attachments live in a private Storage bucket.

1. Copy the settings in [the Product Log environment example](.env.example) into the repository root `.env.local`. Use a development Supabase project for local testing.
2. Apply the [membership migration](supabase/migrations/20261107090000_product_hub.sql), followed by the [shared board migration](supabase/migrations/20261107100000_shared_board.sql).
3. Provision an email/password user in Supabase Auth. Bootstrap the first administrator in the SQL editor, substituting that user's UUID and display name.

   ```sql
   insert into public.hub_members (id, name, role)
   values ('<auth-user-uuid>', '<display-name>', 'Admin');
   ```

4. Provision each teammate in Supabase Auth and add a corresponding `hub_members` row with role `Team Member`. Disable public sign-ups for the internal workspace.
5. Run `npm ci` and `npm run dev`, open `http://localhost:3000`, and sign in. Workspace members can see shared reports and attachments, post reports, and mark them Done or reopen them. Report authors and admins can edit report content. The database records the actor and time for each change.

Public feedback intake is disabled. An independently enabled intake should use a dedicated write-only server endpoint with its own validation, abuse controls, and identity. Keep anonymous access to the internal tables and private attachments revoked.
