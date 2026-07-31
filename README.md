# Beach Sprint Hub v3.6 — Athlete Cloud Migration

## Corrección principal
Los deportistas creados en versiones anteriores podían permanecer únicamente
en localStorage del ordenador. Esta versión los migra automáticamente a
Supabase al iniciar sesión.

## Procedimiento
1. Desplegar esta versión.
2. Abrir primero la aplicación en el ordenador donde aparecen los deportistas.
3. Iniciar sesión y esperar a que indique “Sincronizado”.
4. Abrir la aplicación en el móvil con exactamente la misma cuenta.
5. Cerrar y volver a iniciar sesión en el móvil si estaba abierto.

También se migran las claves locales de las planificaciones asociadas cuando
el deportista recibe su identificador definitivo de Supabase.
