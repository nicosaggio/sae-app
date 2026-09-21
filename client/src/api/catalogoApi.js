import { api } from './client';

/** Igual que `api`, pero con el prefijo /catalogo del módulo. */
export const catalogoApi = {
  get: (ruta) => api.get(`/catalogo${ruta}`),
  post: (ruta, cuerpo) => api.post(`/catalogo${ruta}`, cuerpo),
  put: (ruta, cuerpo) => api.put(`/catalogo${ruta}`, cuerpo),
  del: (ruta) => api.del(`/catalogo${ruta}`),
};
