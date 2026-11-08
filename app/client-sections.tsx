"use client";

import { useRef, useState, type FormEvent, type RefObject } from "react";
import { Plus, X } from "lucide-react";
import { ConfirmAction } from "./cleanup-controls";
import styles from "./board.module.css";

export type ClientSection = { id: string; product: string; name: string };
export const normalizeSectionName = (name: string) => name.trim().replace(/\s+/g, " ");

export default function ClientSections({ products, sections, canCreate, isUsed, onCreate, onDelete, dialogRef }: {
  products: string[]; sections: ClientSection[]; canCreate: boolean;
  isUsed: (id: string) => boolean;
  onCreate: (product: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  dialogRef?: RefObject<HTMLDialogElement | null>;
}) {
  const ownDialog = useRef<HTMLDialogElement>(null);
  const dialog = dialogRef ?? ownDialog;
  const [product, setProduct] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const name = normalizeSectionName(String(new FormData(form).get("name") ?? ""));
    if (!product || !name || name.length > 60) { setError("Choose a product and enter a section name up to 60 characters."); return; }
    setBusy(true); setError("");
    try { await onCreate(product, name); form.reset(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn’t create the section."); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className={styles.secondary} onClick={() => { setError(""); dialog.current?.showModal(); }}>Manage sections</button>
    <dialog ref={dialog} className={styles.dialog} aria-label="Manage client sections" onCancel={event => { if (busy) event.preventDefault(); }}>
      <div className={styles.dialogHead}><h2>Client sections</h2><button type="button" autoFocus disabled={busy} aria-label="Close sections" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      <p className={styles.reportMeta}>Group a product’s clients into sections such as Food, Fruits, or Drinks.</p>
      <label className={styles.sectionScope}>Product<select value={product} disabled={busy} onChange={event => { setProduct(event.target.value); setError(""); }}><option value="">Choose a product</option>{products.map(name => <option key={name}>{name}</option>)}</select></label>
      {!products.length && <p>Create a product first using New product.</p>}
      {product && <>
        {canCreate && <form onSubmit={create} className={styles.sectionCreate}><label>New section<input name="name" required maxLength={60} disabled={busy} placeholder="e.g. Food" /></label><button className={styles.primary} disabled={busy}><Plus size={16} aria-hidden="true" />{busy ? "Creating…" : "Create section"}</button></form>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.catalogGroup}><h3>Sections in {product}</h3>{sections.filter(section => section.product === product).map(section => <div className={styles.catalogRow} key={section.id}><span>{section.name}<small>{isUsed(section.id) ? "Linked to clients" : "No clients yet"}</small></span><ConfirmAction label="Delete section" title={`Delete ${section.name}?`} description="Only unused sections can be deleted. Archived clients still count as linked records." disabled={isUsed(section.id)} onConfirm={() => onDelete(section.id)} /></div>)}
          {!sections.some(section => section.product === product) && <p>No sections yet for this product.</p>}
        </div>
      </>}
    </dialog>
  </>;
}
