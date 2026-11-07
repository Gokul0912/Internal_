"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Building2, ChevronRight, Plus, X } from "lucide-react";
import type { createClient } from "./supabase-client";
import styles from "./board.module.css";
import { ListSkeleton, MotionResults, Notice, useNotice } from "./ui-feedback";
import { CleanupCatalog, ConfirmAction } from "./cleanup-controls";

type Contact = { name: string; role: string; email: string; phone: string };
type Client = { id: string; company: string; website: string; address: string; notes: string; archived: boolean; products: string[]; contacts: Contact[] };
type Data = { clients: Client[]; products: string[] };
const storageKey = "product-log.clients.v1";
const blankContact: Contact = { name: "", role: "", email: "", phone: "" };
function readData(): Data {
  const data = JSON.parse(localStorage.getItem(storageKey) ?? '{"clients":[],"products":[]}') as Data;
  if (!Array.isArray(data.clients) || !Array.isArray(data.products)) throw new Error("Invalid saved directory");
  return data;
}
function websiteUrl(value: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

export default function Clients({ db, canManage, admin }: { db: ReturnType<typeof createClient> | null; canManage: boolean; admin: boolean }) {
  const [data, setData] = useState<Data>({ clients: [], products: [] });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const { notice, notify, dismiss } = useNotice();
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState("");
  const [status, setStatus] = useState("active");
  const [selected, setSelected] = useState<Client | null>(null);
  const [editing, setEditing] = useState<Client | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([{ ...blankContact }]);
  const editor = useRef<HTMLDialogElement>(null);
  const detail = useRef<HTMLDialogElement>(null);
  const productDialog = useRef<HTMLDialogElement>(null);
  const canEdit = !db || canManage;

  async function archiveClient(client: Client, archived: boolean) {
    try {
      let record = { ...client, archived };
      if (db) {
        const result = await db.from("clients").update({ archived }).eq("id", client.id).select().single();
        if (result.error) throw new Error(result.error.message);
        record = result.data as Client;
      }
      const current = db ? data : readData();
      const next = { ...current, clients: current.clients.map(item => item.id === client.id ? record : item) };
      if (!db) localStorage.setItem(storageKey, JSON.stringify(next));
      setData(next);
      detail.current?.close();
      notify(archived ? "Client archived." : "Client restored.", archived ? () => { void archiveClient(record, false).catch(() => {}); } : undefined);
    } catch (failure) { setError("Couldn’t update client status. Try again."); throw failure; }
  }

  async function deleteClient(client: Client) {
    if (db) {
      const result = await db.rpc("delete_archived_client", { p_id: client.id });
      if (result.error) throw new Error(result.error.message);
    }
    const current = db ? data : readData();
    if (!current.clients.find(item => item.id === client.id)?.archived) throw new Error("Archive this client first.");
    const next = { ...current, clients: current.clients.filter(item => item.id !== client.id) };
    if (!db) localStorage.setItem(storageKey, JSON.stringify(next));
    setData(next); detail.current?.close(); notify("Client permanently deleted.");
  }

  async function deleteProduct(name: string) {
    const current = db ? data : readData();
    if (current.clients.some(client => client.products.includes(name))) throw new Error("This product is still linked to clients.");
    if (db) {
      const result = await db.rpc("delete_catalog_entry", { p_kind: "product", p_name: name });
      if (result.error) throw new Error(result.error.message);
    }
    const next = { ...current, products: current.products.filter(item => item !== name) };
    if (!db) localStorage.setItem(storageKey, JSON.stringify(next));
    setData(next); setProduct(""); notify("Unused product deleted.");
  }

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        let next: Data;
        if (db) {
          const [clients, products] = await Promise.all([
            db.from("clients").select("*").order("company"),
            db.from("client_products").select("name").order("name"),
          ]);
          if (clients.error || products.error) throw new Error();
          next = { clients: clients.data as Client[], products: products.data.map(item => item.name) };
        } else next = readData();
        if (active) { setData(next); setReady(true); setError(""); }
      } catch { if (active) setError("Couldn’t load clients. Check your connection and directory setup."); }
    }
    function sync(event: StorageEvent) { if (event.key === storageKey || event.key === null) void load(); }
    void load();
    window.addEventListener("storage", sync);
    return () => { active = false; window.removeEventListener("storage", sync); };
  }, [db]);

  function openEditor(client: Client | null) {
    setEditing(client);
    setContacts(client?.contacts.length ? client.contacts.map(contact => ({ ...contact })) : [{ ...blankContact }]);
    setFormError("");
    detail.current?.close();
    editor.current?.showModal();
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canEdit) return;
    const fields = new FormData(event.currentTarget);
    const company = String(fields.get("company")).trim();
    const website = String(fields.get("website")).trim();
    if (!company || (website && !websiteUrl(website))) {
      setFormError("Enter a company name and a valid HTTP or HTTPS website.");
      return;
    }
    const client: Client = {
      id: editing?.id ?? crypto.randomUUID(), company, website,
      address: String(fields.get("address")).trim(), notes: String(fields.get("notes")).trim(),
      archived: fields.get("archived") === "on", products: fields.getAll("products").map(String),
      contacts: contacts.filter(contact => Object.values(contact).some(value => value.trim()))
        .map(contact => Object.fromEntries(Object.entries(contact).map(([key, value]) => [key, value.trim()])) as Contact),
    };
    if (client.contacts.some(contact => !contact.name)) { setFormError("Add a name for each contact."); return; }
    setBusy(true);
    setFormError("");
    try {
      if (db) {
        const result = editing
          ? await db.from("clients").update(client).eq("id", client.id).select().single()
          : await db.from("clients").insert(client).select().single();
        if (result.error) throw result.error;
        setData(current => ({ ...current, clients: [...current.clients.filter(item => item.id !== client.id), result.data as Client] }));
      } else {
        const current = readData();
        const next = { ...current, clients: [...current.clients.filter(item => item.id !== client.id), client] };
        localStorage.setItem(storageKey, JSON.stringify(next));
        setData(next);
      }
      editor.current?.close();
      notify(editing ? "Client updated." : "Client added.");
    } catch { setFormError("Couldn’t save this client. Try again."); }
    finally { setBusy(false); }
  }
  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canEdit) return;
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name")).trim();
    if (!name) return;
    setBusy(true);
    setFormError("");
    try {
      const current = db ? data : readData();
      if (current.products.some(item => item.toLowerCase() === name.toLowerCase())) {
        setFormError("A product with this name already exists."); return;
      }
      if (db) {
        const result = await db.from("client_products").insert({ name });
        if (result.error) throw result.error;
      }
      const next = { ...current, products: [...current.products, name] };
      if (!db) localStorage.setItem(storageKey, JSON.stringify(next));
      setData(next);
      form.reset();
      productDialog.current?.close();
      notify("Product created.");
    } catch { setFormError("Couldn’t create the product. It may already exist."); }
    finally { setBusy(false); }
  }
  const visible = data.clients.filter(client =>
    (!product || client.products.includes(product))
    && (status === "all" || client.archived === (status === "archived"))
    && [client.company, ...client.contacts.flatMap(contact => [contact.name, contact.email, contact.phone])]
      .join(" ").toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.company.localeCompare(b.company));

  return <>
    <Notice notice={notice} dismiss={dismiss} />
    <header className={styles.hero}><div><h1>Clients</h1><p>The people and companies behind your products.</p></div>
      {canEdit && <button className={styles.primary} disabled={!ready} onClick={() => openEditor(null)}><Plus size={18} /> Add client</button>}
    </header>
    {(!db || admin) && <div className={styles.catalogToolbar}><CleanupCatalog label="Manage products"><section className={styles.catalogGroup}><h3>Products</h3>{data.products.length ? data.products.map(name => {
      const used = data.clients.some(client => client.products.includes(name));
      return <div className={styles.catalogRow} key={name}><span>{name}<small>{used ? "Linked to clients" : "Unused"}</small></span><ConfirmAction label="Delete" title={`Delete ${name}?`} description="This permanently deletes this unused product." disabled={used} onConfirm={() => deleteProduct(name)} /></div>;
    }) : <p>No products yet.</p>}</section></CleanupCatalog></div>}
    {!canEdit && <p className={styles.clientSummary}>You have view-only access. Ask a workspace admin to update client details.</p>}
    <div className={styles.clientSummary}><span><strong>{data.clients.filter(client => !client.archived).length}</strong> active {data.clients.filter(client => !client.archived).length === 1 ? "client" : "clients"}</span><span><strong>{data.products.length}</strong> {data.products.length === 1 ? "product" : "products"}</span></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <section className={styles.panel} aria-label="Client directory">
      <div className={styles.toolbar}><div><h2>Client directory</h2><p aria-live="polite">{visible.length} {visible.length === 1 ? "company" : "companies"}</p></div>
        {canEdit && <button className={styles.secondary} disabled={!ready} onClick={() => { setFormError(""); productDialog.current?.showModal(); }}><Plus size={16} /> New product</button>}
      </div>
      <div className={styles.clientFilters}>
        <label>Search<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Company or contact" /></label>
        <label>Product<select value={product} onChange={event => setProduct(event.target.value)}><option value="">All products</option>{data.products.map(name => <option key={name}>{name}</option>)}</select></label>
        <label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All clients</option></select></label>
      </div>
      <MotionResults changeKey={JSON.stringify([query, product, status, ready])}>
      {!ready && !error ? <ListSkeleton label="Loading clients" /> : visible.length ? <ul className={styles.list}>{visible.map(client => <li key={client.id}>
        <span className={styles.companyAvatar} aria-hidden="true">{client.company.slice(0, 2).toUpperCase()}</span>
        <button className={styles.reportLink} onClick={() => { setSelected(client); detail.current?.showModal(); }}>
          <span><strong>{client.company}</strong><small>{client.contacts[0]?.name ?? "No contact added"} · {client.products.join(", ") || "No product linked"}</small></span><ChevronRight size={18} />
        </button>
      </li>)}</ul> : <div className={styles.empty}><Building2 size={28} /><h3>{error ? "Clients unavailable" : data.clients.length ? "No matching clients" : "Your client directory starts here"}</h3><p>{error ? "Refresh to try loading the directory again." : data.clients.length ? "Try another product, status, or search." : "Add your first company, then link the products they use."}</p></div>}
      </MotionResults>
    </section>
    <dialog ref={editor} className={styles.dialog + " " + styles.clientEditor} aria-label={editing ? "Edit client" : "Add client"} onCancel={event => { if (busy) event.preventDefault(); }}>
      <form onSubmit={save} key={editing?.id ?? "new-client"}>
        <div className={styles.dialogHead}><h2>{editing ? "Edit client" : "Add client"}</h2><button type="button" disabled={busy} aria-label="Close" onClick={() => editor.current?.close()}><X size={20} /></button></div>
        <fieldset disabled={busy} className={styles.clientFields}>
          <label>Company name<input name="company" defaultValue={editing?.company} autoFocus required maxLength={120} /></label>
          <label>Website<input name="website" type="url" defaultValue={editing?.website} maxLength={300} placeholder="https://example.com" /></label>
          <fieldset className={styles.productChoices}><legend>Products</legend>
            {data.products.length ? data.products.map(name => <label key={name}><input name="products" type="checkbox" value={name} defaultChecked={editing?.products.includes(name)} />{name}</label>) : <p>Create a product from the directory to link it here.</p>}
          </fieldset>
          <details open={Boolean(editing)}><summary>Contacts and internal details</summary><div className={styles.clientFields}>
            {contacts.map((contact, index) => <fieldset key={index} className={styles.contactFields}><legend>{index === 0 ? "Primary contact" : "Contact " + (index + 1)}</legend>
              {(["name", "role", "email", "phone"] as const).map(field => <label key={field}>{field === "name" ? "Contact name" : field === "role" ? "Role" : field === "email" ? "Email" : "Phone"}
                <input type={field === "email" ? "email" : field === "phone" ? "tel" : "text"} maxLength={field === "email" ? 254 : field === "phone" ? 60 : 120} value={contact[field]}
                  onChange={event => setContacts(current => current.map((item, position) => position === index ? { ...item, [field]: event.target.value } : item))} />
              </label>)}
              <button className={styles.secondary} type="button" onClick={() => setContacts(current => current.filter((_, position) => position !== index))}>Remove contact</button>
            </fieldset>)}
            <button className={styles.secondary} type="button" disabled={contacts.length >= 20} onClick={() => setContacts(current => [...current, { ...blankContact }])}>Add contact</button>
            <label>Address<textarea name="address" maxLength={500} defaultValue={editing?.address} rows={2} /></label>
            <label>Internal notes<textarea name="notes" maxLength={4000} defaultValue={editing?.notes} rows={3} /></label>
          </div></details>
          <label className={styles.checkboxLabel}><input name="archived" type="checkbox" defaultChecked={editing?.archived} /> Archived</label>
        </fieldset>
        {formError && <p role="alert" className={styles.error}>{formError}</p>}
        <button className={styles.primary} disabled={busy}>{busy && <span className={styles.spinner} aria-hidden="true" />}{busy ? "Saving…" : "Save client"}</button>
      </form>
    </dialog>
    <dialog ref={productDialog} className={styles.dialog} aria-label="New product" onCancel={event => { if (busy) event.preventDefault(); }}>
      <form onSubmit={addProduct}><div className={styles.dialogHead}><h2>New product</h2><button type="button" disabled={busy} aria-label="Close" onClick={() => productDialog.current?.close()}><X size={20} /></button></div>
        <label>Product name<input name="name" required autoFocus maxLength={80} /></label>
        {formError && <p role="alert" className={styles.error}>{formError}</p>}
        <button className={styles.primary} disabled={busy}>{busy && <span className={styles.spinner} aria-hidden="true" />}{busy ? "Saving…" : "Create product"}</button>
      </form>
    </dialog>
    <dialog ref={detail} className={styles.dialog + " " + styles.detail} aria-label="Client details">
      <div className={styles.dialogHead}><h2>{selected?.company}</h2><button autoFocus aria-label="Close client" onClick={() => detail.current?.close()}><X size={20} /></button></div>
      {selected && <div className={styles.clientFields}>
        <span className={styles.badge} data-done={!selected.archived}>{selected.archived ? "Archived" : "Active"}</span>
        <h3>Products</h3><p>{selected.products.join(", ") || "No products linked"}</p>
        {websiteUrl(selected.website) && <a href={websiteUrl(selected.website)} target="_blank" rel="noopener noreferrer">{selected.website}</a>}
        <h3>Contacts</h3>
        {selected.contacts.map((contact, index) => <article key={index} className={styles.contactCard}>
          <strong>{contact.name}</strong><p>{index === 0 ? "Primary contact" : "Contact"}{contact.role && " · " + contact.role}</p>
          {contact.email && <a href={"mailto:" + encodeURIComponent(contact.email)}>{contact.email}</a>}
          {contact.phone && <a href={"tel:" + contact.phone.replace(/[^+\d]/g, "")}>{contact.phone}</a>}
        </article>)}
        {!selected.contacts.length && <p>No contacts added.</p>}
        <h3>Address</h3><p className={styles.description}>{selected.address || "No address added."}</p>
        <h3>Internal notes</h3><p className={styles.description}>{selected.notes || "No notes added."}</p>
        {canEdit && <button className={styles.secondary} onClick={() => openEditor(selected)}>Edit client</button>}
        {canEdit && (selected.archived ? <button className={styles.secondary} onClick={() => void archiveClient(selected, false).catch(() => {})}>Restore client</button> : <ConfirmAction label="Archive client" title="Archive this client?" description="The client stays available under Archived and can be restored at any time." onConfirm={() => archiveClient(selected, true)} />)}
        {selected.archived && (!db || admin) && <ConfirmAction label="Delete permanently" title="Permanently delete client?" description="All company and contact details will be removed. This cannot be undone." onConfirm={() => deleteClient(selected)} />}
      </div>}
    </dialog>
  </>;
}
