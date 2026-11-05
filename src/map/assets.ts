/** URL absoluta de un archivo de /public: MapLibre lee desde workers, que no resuelven rutas relativas */
export const assetUrl = (path: string) => new URL(import.meta.env.BASE_URL + path.replace(/^\//, ""), location.href).href;
