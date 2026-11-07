# Record cleanup

Apply `supabase/migrations/20261107170000_record_cleanup.sql` in Supabase SQL Editor after the earlier migrations. It is safe to rerun. Deploy the matching frontend afterward. The migration does not delete existing records.

- Report author or Admin (excluding Viewer accounts): move to Trash, restore within 30 days, remove attachments.
- Admin: permanently delete reports in Trash after removing their attachments; permanently delete archived clients; delete unused projects, products, and report types.
- Admin, Developer, Team Member: archive and restore clients, using the existing client update policies from `20261107160000_client_team_permissions.sql`.
- Trash entries continue to protect their project/type references. Archived clients continue to protect linked products.
- Undo lasts six seconds; reports remain accessible through Trash afterward. No scheduled purge is installed. Records beyond the restore window remain in Trash until an Admin removes them.
- Attachment removal first commits the report metadata change, then removes the detached storage object. If storage cleanup fails, the app displays an explicit error; the private detached file must be cleaned by an administrator. Attached objects cannot be deleted through the cleanup storage policy.

The RPCs enforce permissions using the authenticated database identity. Clients cannot directly modify the trash timestamp. A transaction advisory lock serializes reference changes with catalog deletion to protect the small internal directory against concurrent writes. This is intentionally coarse for the internal app; a normalized product/client relation would be preferable at higher write volumes.

## Verification

Run `npm ci`, then:

```
node scripts/verify-cleanup-db.mjs
npm run build
```

With the app running locally on port 3000 without Supabase environment variables:

```
node scripts/verify-motion.mjs
node scripts/verify-cleanup-ui.mjs
```

Browser tests use isolated storage; they never modify production data. Set `CHROME_PATH` if Chrome is installed outside its default Windows location. Database tests run actual migrations and role checks in an in-memory PostgreSQL engine with minimal Supabase auth/storage stubs. They do not replace a production Supabase smoke check or a concurrency load test.
