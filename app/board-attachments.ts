export const attachmentTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"];
export const maxAttachmentBytes = 25 * 1024 * 1024;

async function withAttachments<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("product-hub-attachments", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("reports");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("reports", mode);
      const request = operation(transaction.objectStore("reports"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export function saveAttachments(id: string, files: File[]) {
  return withAttachments("readwrite", store => store.put(files, id));
}

export function readAttachments(id: string): Promise<File[] | undefined> {
  return withAttachments("readonly", store => store.get(id));
}

export function removeAttachments(id: string) {
  return withAttachments("readwrite", store => store.delete(id));
}
