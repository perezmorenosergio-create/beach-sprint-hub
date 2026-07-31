# Beach Sprint Hub v3.7 — Mobile Logout & Cache Fix

Correcciones:
- Cierre de sesión inmediato incluso si Supabase no responde.
- Limpieza local de los tokens de autenticación.
- Botón “Restablecer app” para borrar caché y datos locales del dispositivo.
- Service Worker network-first para evitar que el móvil conserve versiones antiguas.
- Eliminación automática de cachés anteriores.
- Parámetros de salida/restablecimiento para impedir que el callback de autenticación vuelva a entrar automáticamente.

Uso recomendado:
1. Desplegar en Vercel.
2. En móvil abrir la URL añadiendo `?v=37` una vez.
3. Pulsar “Restablecer app”.
4. Iniciar sesión de nuevo con la misma cuenta.
