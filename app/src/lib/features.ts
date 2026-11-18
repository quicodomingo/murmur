/**
 * What's built but not out yet: on in development (`npm run tauri dev`), off in the published app.
 * To release one, set it to `true` (and update the READMEs, which leave it out meanwhile).
 */

/** Configuració › Mòbil and the sync icon: until Murmur for iPhone is on the App Store in the EU. */
export const PHONE_APP = import.meta.env.DEV;

/** Signing in with Google Calendar: until Google verifies the app (until then it warns, and caps it at 100 people). */
export const GOOGLE_CALENDAR = import.meta.env.DEV;
