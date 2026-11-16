import { open } from "@tauri-apps/plugin-dialog";
import { api } from "./api";

/**
 * Lets the user pick an image (or an .exe/.lnk/.ico to borrow its icon) and
 * returns it as a PNG data URL, or null if they cancel or it can't be read.
 */
export async function pickIcon(): Promise<string | null> {
  const path = await open({
    title: "Choose an icon",
    multiple: false,
    directory: false,
    filters: [
      { name: "Images and apps", extensions: ["png", "jpg", "jpeg", "ico", "bmp", "webp", "exe", "lnk"] },
    ],
  });
  if (typeof path !== "string") return null;
  try {
    return await api.loadCustomIcon(path);
  } catch (e) {
    console.error(e);
    return null;
  }
}

/** Lets the user pick an app, shortcut or folder to pin. */
export async function pickApp(): Promise<string | null> {
  const path = await open({
    title: "Add an app to the dock",
    multiple: false,
    directory: false,
    filters: [{ name: "Apps and shortcuts", extensions: ["exe", "lnk", "url", "bat", "cmd"] }],
  });
  return typeof path === "string" ? path : null;
}
