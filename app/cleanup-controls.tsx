"use client";

import { useRef, useState, type ReactNode } from "react";
import { Trash2, X } from "lucide-react";
import styles from "./board.module.css";

export function ConfirmAction({ label, title, description, onConfirm, disabled = false }: {
  label: string; title: string; description: string; onConfirm: () => Promise<void>; disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <>
    <button className={styles.danger} type="button" disabled={disabled} onClick={() => { setError(""); dialog.current?.showModal(); }}><Trash2 size={16} aria-hidden="true" />{label}</button>
    <dialog ref={dialog} className={styles.dialog} aria-label={title} onCancel={event => { if (busy) event.preventDefault(); }}>
      <form onSubmit={async event => {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError("");
        try { await onConfirm(); dialog.current?.close(); }
        catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn’t complete this action. Try again."); }
        finally { setBusy(false); }
      }}>
        <h2>{title}</h2><p>{description}</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.detailActions}>
          <button autoFocus type="button" className={styles.secondary} disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button>
          <button className={styles.danger} disabled={busy} type="submit">{busy ? "Working…" : label}</button>
        </div>
      </form>
    </dialog>
  </>;
}

export function CleanupCatalog({ children, label = "Manage lists", description = "Active reports protect their projects. Reports in Trash won’t block project deletion. Products and report types must have no linked records." }: { children: ReactNode; label?: string; description?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button className={styles.secondary} type="button" onClick={() => dialog.current?.showModal()}>{label}</button>
    <dialog ref={dialog} className={styles.dialog} aria-label={label}>
      <div className={styles.dialogHead}><h2>{label}</h2><button autoFocus type="button" aria-label="Close list manager" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      <p className={styles.reportMeta}>{description}</p>
      {children}
    </dialog>
  </>;
}
