# Beach Sprint Hub v3.11 — Hard Navigation Fix

La navegación ya no depende de app.js, Supabase ni planificación.

- Script mínimo de navegación incluido directamente en index.html.
- onclick directo en cada pestaña.
- Cierre de sesión de emergencia directo.
- Las vistas cambian también mediante style.display, no solo clases CSS.
- Insignia v3.11 visible abajo a la derecha para confirmar la versión.
- Service Worker sin caché de aplicación antigua.

Prueba:
1. Abrir con ?v=311.
2. Confirmar que aparece “v3.11” abajo a la derecha.
3. Pulsar Deportistas, Planificación e Historial.
