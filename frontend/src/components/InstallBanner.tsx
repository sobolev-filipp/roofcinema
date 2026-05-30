import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dismissInstallBanner, isInstallBannerDismissed, isStandalone } from "../lib/pwa";

/** Всплывающий баннер с предложением установить PWA.
 *  Показывается один раз (до закрытия крестиком), не показывается в установленном
 *  приложении (standalone). Факт закрытия хранится в localStorage. */
export default function InstallBanner() {
  const nav = useNavigate();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isStandalone() || isInstallBannerDismissed()) return;
    // Небольшая задержка, чтобы баннер «выскочил» уже после загрузки страницы.
    const t = setTimeout(() => setShow(true), 700);
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;

  function close() {
    dismissInstallBanner();
    setShow(false);
  }

  function openInstall() {
    dismissInstallBanner();
    setShow(false);
    nav("/install");
  }

  return (
    <div className="install-banner" role="dialog" aria-label="Установка приложения">
      <div className="install-banner-icon" aria-hidden="true">📲</div>
      <div className="install-banner-text">
        <b>Установите приложение</b>
        <span>«Кино на крыше» на экран телефона — запуск в одно касание и QR-билеты под рукой.</span>
      </div>
      <button type="button" className="primary btn-sm install-banner-cta" onClick={openInstall}>
        Установить
      </button>
      <button
        type="button"
        className="install-banner-close"
        aria-label="Закрыть"
        onClick={close}
      >
        ✕
      </button>
    </div>
  );
}
