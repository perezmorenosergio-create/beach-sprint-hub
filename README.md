# Beach Sprint Hub v3.17 — Planning Init Root Fix

Fallo real localizado y corregido:

- `app.js` llamaba a `resetAppButton.addEventListener(...)`.
- `resetAppButton` no existe en `index.html`.
- Esa excepción detenía JavaScript antes de `createPlanningModule(...)`.
- Por eso `window.BSTImportPlanning` nunca se registraba.

Corrección:

- El botón opcional usa ahora `?.addEventListener`.
- Todos los módulos están versionados con `?v=317`.
- Caché desactivada para evitar mezclas de versiones.
- Service Worker limpia cachés anteriores.
