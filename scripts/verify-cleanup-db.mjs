import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// In-memory PostgreSQL. Supabase auth/storage primitives are stubbed; application
// migrations, RLS policies, grants and cleanup functions run unchanged.
const db = new PGlite();
const author = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const admin = "33333333-3333-4333-8333-333333333333";
const viewer = "44444444-4444-4444-8444-444444444444";
const report = "55555555-5555-4555-8555-555555555555";
async function actor(id) {
  await db.exec("reset role");
  await db.query("select set_config('test.actor', $1, false)", [id]);
  await db.exec("set role authenticated");
}
async function rejected(sql, args = []) { await assert.rejects(db.query(sql, args)); }
try {
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; create schema storage;
    grant usage on schema public,auth,storage to authenticated;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor', true),'')::uuid $$;
    create table public.hub_members(id uuid primary key, name text, role text);
    create function public.hub_role() returns text language sql stable security definer as $$ select role from public.hub_members where id=auth.uid() $$;
    create table storage.objects(id uuid, bucket_id text, name text);
    alter table storage.objects enable row level security;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
    insert into public.hub_members values('${author}','Author','Team Member'),('${other}','Other','Team Member'),('${admin}','Admin','Admin'),('${viewer}','Viewer','Viewer');
  `);
  for (const file of ["20261107100000_shared_board.sql", "20261107110000_board_projects.sql", "20261107120000_clients.sql", "20261107160000_client_team_permissions.sql", "20261107170000_record_cleanup.sql"]) {
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  }
  // Re-running the cleanup migration must be safe.
  await db.exec(await readFile("supabase/migrations/20261107170000_record_cleanup.sql", "utf8"));
  const projectPermissionMigration = await readFile("supabase/migrations/20261108090000_member_project_deletion.sql", "utf8");
  await db.exec(projectPermissionMigration);
  await db.exec(projectPermissionMigration);
  const trashProjectMigration = await readFile("supabase/migrations/20261108093000_delete_projects_with_trashed_reports.sql", "utf8");
  await db.exec(trashProjectMigration);
  await db.exec(trashProjectMigration);
  const clientPermissionMigration = await readFile("supabase/migrations/20261108100000_member_archived_client_deletion.sql", "utf8");
  await db.exec(clientPermissionMigration);
  await db.exec(clientPermissionMigration);
  const developer = "77777777-7777-4777-8777-777777777777";
  await db.query("insert into public.hub_members values($1,'Developer','Developer')", [developer]);
  for (const member of [author, other, admin, viewer, developer]) {
    const archivedClient = "99999999-9999-4999-8999-999999999999";
    await actor(admin);
    await db.query("insert into public.clients(id,company) values($1,'Role cleanup test')", [archivedClient]);
    await actor(member);
    await rejected("select public.delete_archived_client($1)", [archivedClient]);
    await actor(admin);
    await db.query("update public.clients set archived=true where id=$1", [archivedClient]);
    await actor(member);
    await db.query("select public.delete_archived_client($1)", [archivedClient]);
    assert.equal((await db.query("select count(*)::int as count from public.clients where id=$1", [archivedClient])).rows[0].count, 0);
    await actor(member);
    await db.exec("insert into public.board_projects(name) values('Unused')");
    await db.exec("select public.delete_catalog_entry('project','Unused')");
    assert.equal((await db.query("select count(*)::int as count from public.board_projects where name='Unused'")).rows[0].count, 0);
    if (member !== admin) {
      await rejected("select public.delete_catalog_entry('type','Update report')");
      await rejected("select public.delete_catalog_entry('product','Unused')");
    }
  }
  await actor("88888888-8888-4888-8888-888888888888");
  await rejected("select public.delete_catalog_entry('project','Unused')");
  await rejected("select public.delete_archived_client('99999999-9999-4999-8999-999999999999')");
  await db.exec("reset role; set role anon");
  await rejected("select public.delete_catalog_entry('project','Unused')");
  await rejected("select public.delete_archived_client('99999999-9999-4999-8999-999999999999')");
  await actor(author);
  await db.query("insert into public.board_reports(id,title,details,type,project) values($1,'Report','','Bug report','Project')", [report]);
  await rejected("update public.board_reports set deleted_at=now() where id=$1", [report]);
  await actor(other);
  await rejected("select public.delete_catalog_entry('project','Project')");
  await rejected("select public.cleanup_report($1,'trash')", [report]);
  await actor(viewer);
  await rejected("select public.cleanup_report($1,'trash')", [report]);
  await actor(author);
  await db.query("select public.cleanup_report($1,'trash')", [report]);
  await rejected("select public.cleanup_report($1,'purge')", [report]);
  await actor(viewer);
  await db.exec("select public.delete_catalog_entry('project','Project')");
  assert.equal((await db.query("select count(*)::int as count from public.board_reports where id=$1 and deleted_at is not null", [report])).rows[0].count, 1);
  await actor(author);
  await db.query("select public.cleanup_report($1,'restore')", [report]);
  assert.equal((await db.query("select deleted_at from public.board_reports where id=$1", [report])).rows[0].deleted_at, null);
  assert.equal((await db.query("select project from public.board_reports where id=$1", [report])).rows[0].project, null);
  assert.equal((await db.query("select count(*)::int as count from public.board_projects where name='Project'")).rows[0].count, 0);
  await db.query("update public.board_reports set project='Project' where id=$1", [report]);
  await actor(admin);
  await rejected("select public.delete_catalog_entry('project','Project')");
  await rejected("select public.delete_catalog_entry('type','Bug report')");
  await db.query("select public.cleanup_report($1,'trash')", [report]);
  await db.exec("reset role");
  await db.query("update public.board_reports set deleted_at=now()-interval '31 days' where id=$1", [report]);
  await actor(author);
  await rejected("select public.cleanup_report($1,'restore')", [report]);
  await actor(admin);
  await db.query("select public.cleanup_report($1,'purge')", [report]);
  await db.exec("select public.delete_catalog_entry('project','Project'); select public.delete_catalog_entry('type','Bug report')");
  await actor(author);
  await db.exec("insert into public.client_products(name) values('Product')");
  const client = "66666666-6666-4666-8666-666666666666";
  await db.query("insert into public.clients(id,company,products) values($1,'Company',array['Product'])", [client]);
  await rejected("select public.delete_catalog_entry('product','Product')");
  await actor(admin);
  await rejected("select public.delete_catalog_entry('product','Product')");
  await rejected("select public.delete_archived_client($1)", [client]);
  await db.query("update public.clients set archived=true where id=$1", [client]);
  await actor(author);
  await db.query("select public.delete_archived_client($1)", [client]);
  await actor(admin);
  await db.exec("select public.delete_catalog_entry('product','Product')");
  assert.equal((await db.query("select count(*)::int as count from public.clients")).rows[0].count, 0);
  await db.exec("reset role");
  const path = `${author}/${report}/file`;
  await db.query("insert into storage.objects(bucket_id,name) values('board-attachments',$1)", [path]);
  await actor(author);
  await db.query("insert into public.board_types(name) values('Files')");
  await db.query("insert into public.board_reports(id,title,details,type,project,attachments) values($1,'Files','','Files','Project',$2::jsonb)", [report, JSON.stringify([{ path, name: "file.png", type: "image/png" }])]);
  await db.query("select public.cleanup_report($1,'trash')", [report]);
  await actor(admin);
  await rejected("select public.cleanup_report($1,'purge')", [report]);
  await actor(viewer);
  await db.exec("select public.delete_catalog_entry('project','Project')");
  assert.equal((await db.query("select attachments from public.board_reports where id=$1", [report])).rows[0].attachments.length, 1);
  await actor(other);
  await rejected("select public.cleanup_report($1,'remove_attachment',$2)", [report, path]);
  await actor(author);
  await rejected("select public.cleanup_report($1,'remove_attachment','missing')", [report]);
  await db.query("select public.cleanup_report($1,'remove_attachment',$2)", [report, path]);
  assert.equal((await db.query("select attachments from public.board_reports where id=$1", [report])).rows[0].attachments.length, 0);
  assert.equal((await db.query("select count(*)::int as count from public.board_projects where name='Project'")).rows[0].count, 0);
  console.log("PASS: all member roles can delete unused projects; outsiders/anonymous and non-Admin product/type deletion denied; migration rerun, trash permissions, restore window, linked catalog protection, archived-client deletion.");
} finally { await db.close(); }
