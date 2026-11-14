// La sessió «importa»: l'app oberta amb un fitxer d'àudio (wdio.conf.mjs).
globalThis.MURMUR_E2E_SUITE = "importa";
export const { config } = await import("./wdio.conf.mjs");
