# Product-scoped client sections

Apply `supabase/migrations/20261108110000_client_product_sections.sql` after the existing client and cleanup migrations, then deploy the frontend. The migration is safe to rerun. Existing clients get an empty section selection; no client or contact details are replaced.

## Use

1. In Clients, choose Manage sections, select a product, and create Food, Fruits, Drinks, or any section name up to 60 characters.
2. Add or edit a client. Select its products, then select the relevant sections grouped under each product. A client can belong to more than one section.
3. In the directory, select Product, then Section. No section shows clients not yet categorized for that product. Status and search continue to work alongside both filters.

Manage sections is also available inside the client form, preserving entered details while a section is created. Changing a client's products clears incompatible section selections. Client rows and detail drawers show assigned sections.

Products in Clients are the parent registry; sidebar report Projects remain separate, as requested. Identical section names are allowed under different products, but names are unique within each product ignoring case and repeated whitespace.

## Permissions and integrity

Admin, Developer, and Team Member accounts can create sections and edit client assignments. Every workspace member can view sections and delete unused ones after confirmation. Archived clients protect their section references. Products with sections cannot be deleted until their sections are removed.

Client section IDs are validated against selected products by a database trigger; mismatched, missing, null, or duplicate references are rejected. Section deletion uses the existing reference transaction lock, preventing a concurrent client save from introducing a dangling section reference. The bounded UUID array matches the existing clients product-array model and keeps each client save atomic. At higher scale, a normalized client/section join table would support more flexible querying.

## Tests

Run `node scripts/verify-cleanup-db.mjs` for migration and permission checks. With the app running locally without Supabase environment variables, run `node scripts/verify-client-sections.mjs` for isolated browser checks. These tests do not modify production data.
