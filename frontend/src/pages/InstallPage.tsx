import { useEffect, useState } from "react";

/** Событие, пойманное до показа системного диалога установки Chrome/Android. */
let _deferredPrompt: any = null;
const _listeners: Array<() => void> = [];

// Глобально перехватываем событие как можно раньше
window.addEventListener("beforeinstallprompt", (e: any) => {
  e.preventDefault();
  _deferredPrompt = e;
  _listeners.forEach((fn) => fn());
});

function useInstallPrompt() {
  const [prompt, setPrompt] = useState<any>(_deferredPrompt);

  useEffect(() => {
    const update = () => setPrompt(_deferredPrompt);
    _listeners.push(update);
    return () => {
      const idx = _listeners.indexOf(update);
      if (idx !== -1) _listeners.splice(idx, 1);
    };
  }, []);

  return prompt;
}

function detectPlatform(): "ios" | "android" | "desktop-chrome" | "other" {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/chrome/.test(ua) && !/android|iphone|ipad/.test(ua)) return "desktop-chrome";
  return "other";
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

export default function InstallPage() {
  const prompt = useInstallPrompt();
  const [installed, setInstalled] = useState(isStandalone);
  const [installing, setInstalling] = useState(false);
  const platform = detectPlatform();

  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const handler = () => setInstalled(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  async function handleInstall() {
    if (!prompt) return;
    setInstalling(true);
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") setInstalled(true);
    } finally {
      setInstalling(false);
      _deferredPrompt = null;
    }
  }

  if (installed) {
    return (
      <div className="container" style={{ maxWidth: 540 }}>
        <div className="card" style={{ marginTop: 24, textAlign: "center" }}>
          <div style={{ fontSize: 56 }}>✅</div>
          <h2 style={{ marginTop: 8 }}>Приложение установлено</h2>
          <p className="muted" style={{ fontSize: 14 }}>
            «Кино на крыше» уже добавлено на ваш экран. Запускайте его как обычное приложение.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 580 }}>
      <h1 style={{ marginTop: 24 }}>Установить приложение</h1>
      <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
        «Кино на крыше» можно установить на телефон или компьютер — работает без магазина приложений,
        запускается как обычное приложение и занимает минимум места.
      </p>

      {/* Кнопка для Chrome / Android если доступен prompt */}
      {prompt && (
        <div className="card" style={{ marginTop: 20, borderColor: "var(--accent)" }}>
          <h3 style={{ marginTop: 0 }}>Быстрая установка</h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
            Браузер готов установить приложение — нажмите кнопку ниже.
          </p>
          <button className="primary" style={{ width: "100%" }} onClick={handleInstall} disabled={installing}>
            {installing ? "Устанавливаем..." : "📲 Установить"}
          </button>
        </div>
      )}

      {/* Инструкция по платформе */}
      <div style={{ marginTop: 24 }}>
        {platform === "ios" && <IosGuide />}
        {platform === "android" && <AndroidGuide />}
        {platform === "desktop-chrome" && <ChromeGuide />}
        {platform === "other" && (
          <>
            <IosGuide />
            <div style={{ marginTop: 24 }}><AndroidGuide /></div>
            <div style={{ marginTop: 24 }}><ChromeGuide /></div>
          </>
        )}
      </div>

      <div className="hint-box" style={{ marginTop: 24, fontSize: 13 }}>
        <b>Зачем устанавливать?</b>
        <ul style={{ marginTop: 6, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Запускается в одно нажатие с экрана телефона или рабочего стола</li>
          <li>Полноэкранный режим без адресной строки браузера</li>
          <li>Быстрый доступ к QR-кодам броней — даже при плохом сигнале</li>
          <li>Уведомления о бронях (если разрешить)</li>
        </ul>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 16 }}>
      <div
        style={{
          width: 30, height: 30, borderRadius: "50%",
          background: "var(--accent)", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 14, flexShrink: 0,
        }}
      >
        {n}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.6, paddingTop: 4 }}>{children}</div>
    </div>
  );
}

function IosGuide() {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>
        <span style={{ marginRight: 8 }}>🍎</span>iPhone / iPad (Safari)
      </h3>
      <Step n={1}>
        Откройте сайт в браузере <b>Safari</b>. Другие браузеры (Chrome, Firefox) на iOS
        не поддерживают установку PWA.
      </Step>
      <Step n={2}>
        Нажмите кнопку «Поделиться» в нижней панели —{" "}
        <span style={{ fontSize: 18 }}>⬆</span> квадрат со стрелкой.
      </Step>
      <Step n={3}>
        Прокрутите список вниз и выберите{" "}
        <b>«На экран "Домой"»</b> (Add to Home Screen).
      </Step>
      <Step n={4}>
        Нажмите <b>«Добавить»</b> в правом верхнем углу. Значок «Кино на крыше» появится на рабочем столе.
      </Step>
    </div>
  );
}

function AndroidGuide() {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>
        <span style={{ marginRight: 8 }}>🤖</span>Android (Chrome)
      </h3>
      <Step n={1}>
        Откройте сайт в браузере <b>Chrome</b>.
      </Step>
      <Step n={2}>
        Нажмите на три точки <b>⋮</b> в правом верхнем углу.
      </Step>
      <Step n={3}>
        Выберите <b>«Добавить на главный экран»</b> или <b>«Установить приложение»</b>.
      </Step>
      <Step n={4}>
        Подтвердите установку. Значок появится на рабочем столе и в ящике приложений.
      </Step>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        Если пункта нет в меню — нажмите на всплывающую подсказку установки в нижней части экрана (если она появилась).
      </div>
    </div>
  );
}

function ChromeGuide() {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>
        <span style={{ marginRight: 8 }}>🖥️</span>Компьютер (Chrome / Edge)
      </h3>
      <Step n={1}>
        В адресной строке Chrome найдите значок{" "}
        <b>⊕</b> (установить) — обычно он появляется справа от адреса.
      </Step>
      <Step n={2}>
        Нажмите на значок и выберите <b>«Установить»</b> в диалоге.
      </Step>
      <Step n={3}>
        Приложение откроется в отдельном окне и добавится в список приложений.
      </Step>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        В Edge: меню <b>⋯</b> → «Приложения» → «Установить этот сайт как приложение».
      </div>
    </div>
  );
}
