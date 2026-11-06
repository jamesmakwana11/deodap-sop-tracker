/** File downloads need the server; the static preview build (vite --mode preview) has none. */
export const reportsAvailable = import.meta.env.MODE !== 'preview';
