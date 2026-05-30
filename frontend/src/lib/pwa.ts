/** Утилиты определения режима PWA (standalone) — чтобы не показывать
 *  баннер/плашку установки тем, кто уже запустил приложение как PWA. */

/** Запущено ли приложение в режиме установленного PWA. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mql = window.matchMedia?.("(display-mode: standalone)").matches;
  // iOS Safari использует нестандартный navigator.standalone
  const iosStandalone = (window.navigator as any).standalone === true;
  return Boolean(mql || iosStandalone);
}

const DISMISS_KEY = "pwa_install_banner_dismissed";

/** Был ли баннер установки уже закрыт пользователем. */
export function isInstallBannerDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Запомнить, что баннер закрыт — больше не показывать. */
export function dismissInstallBanner(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* localStorage недоступен — не критично */
  }
}
