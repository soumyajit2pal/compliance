/** Public assets share one base in the built portal and the Vite dev server. */
export const assetUrl = (path: string) => import.meta.env.BASE_URL + path.replace(/^\/+/, '');
