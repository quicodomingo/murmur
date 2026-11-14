// L'app com la veu qui l'obre per primer cop a Windows o Linux: la benvinguda, la finestra
// principal, les dreceres amb Ctrl i una configuració sense el que només existeix a macOS.
import { ca, catalanAndOnboarded, ctrl, pageText, waitForApp } from "./helpers.mjs";

const linux = process.platform === "linux";

describe("Murmur a " + process.platform, () => {
  before(async () => {
    await waitForApp();
  });

  it("obre la finestra principal amb el títol «Murmur»", async () => {
    await browser.waitUntil(async () => (await browser.getTitle()) === "Murmur", { timeoutMsg: "La finestra no es diu Murmur" });
  });

  it("mostra la benvinguda el primer cop", async () => {
    const dialog = await $("[role=dialog]");
    await dialog.waitForDisplayed({ timeout: 30_000 });
  });

  it("parla en català i diu «ordinador», no «Mac»", async () => {
    await catalanAndOnboarded();
    // Sense el model, l'app torna a obrir la benvinguda al pas dels models: la tanquem.
    if (await $("[role=dialog]").isDisplayed().catch(() => false)) await browser.keys("Escape");
    await browser.waitUntil(async () => (await pageText()).includes(ca("sidebar:newMeeting")), { timeoutMsg: "No surt «Nova reunió»" });
    const text = await pageText();
    if (!text.includes(ca("sidebar:localOnly"))) throw new Error(`Hauria de dir «${ca("sidebar:localOnly")}»`);
    if (/aquest Mac|Finder|⌘/.test(text)) throw new Error("Hi ha textos de Mac a la finestra principal");
  });

  it("mostra les dreceres amb Ctrl", async () => {
    const text = await pageText();
    if (!text.includes("Ctrl+N")) throw new Error("La drecera de «Nova reunió» hauria de ser Ctrl+N");
  });

  it("obre la configuració amb Ctrl+,", async () => {
    await $("body").click();
    await ctrl(",");
    await browser.waitUntil(async () => (await pageText()).includes(ca("settings:tabs.audio")), { timeoutMsg: "No s'ha obert la configuració" });
  });

  it("no ofereix el calendari de macOS", async () => {
    const labels = await browser.execute(() => [...document.querySelectorAll("[role=dialog] button")].map((b) => b.innerText.trim()));
    if (labels.includes(ca("settings:tabs.calendar"))) throw new Error("La pestanya Calendari només és per a macOS");
  });

  it("a la pestanya Àudio, sense els permisos de macOS", async () => {
    const tab = await $(`button=${ca("settings:tabs.audio")}`);
    await tab.click();
    await browser.waitUntil(async () => (await pageText()).includes(ca("settings:audio.sources")));
    const text = await pageText();
    if (text.includes(ca("settings:permissions.title"))) throw new Error("Els permisos són de macOS");
    const system = text.includes(ca("settings:audio.system"));
    // A Windows, l'àudio de l'altra banda de la trucada (WASAPI); a Linux encara no.
    if (linux && system) throw new Error("A Linux no hi ha àudio del sistema");
    if (!linux && !system) throw new Error("A Windows hi ha d'haver l'àudio del sistema");
  });
});
