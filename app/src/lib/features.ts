/**
 * What's built but not out yet: on in development (`npm run tauri dev`), off in the published app.
 * To release one, set it to `true` (and update the READMEs, which leave it out meanwhile).
 */

/** Configuració › Mòbil and the sync icon: out since Murmur for iPhone reached the App Store in the EU (0.18.0). */
export const PHONE_APP = true;

/** Signing in with Google Calendar: until Google verifies the app (until then it warns, and caps it at 100 people). */
export const GOOGLE_CALENDAR = import.meta.env.DEV;
