import { useEffect, useRef } from "react";

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { L?: any }
}

function ensureLeaflet(): Promise<void> {
  if (window.L) return Promise.resolve();
  // CSS
  if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = LEAFLET_CSS;
    document.head.appendChild(link);
  }
  // JS
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${LEAFLET_JS}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      if ((existing as any)._loaded) resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = LEAFLET_JS;
    s.async = true;
    s.onload = () => { (s as any)._loaded = true; resolve(); };
    s.onerror = () => reject(new Error("Не удалось загрузить Leaflet"));
    document.head.appendChild(s);
  });
}

type Props = {
  lat: number;
  lng: number;
  /** Радиус круга в метрах. Если задан — рисуется круг и карта центрируется так, чтобы он влез. */
  radiusM?: number;
  /** Точный маркер (если разрешено показывать адрес). */
  exact?: boolean;
  height?: number;
};

/** Текущая тема из <html data-theme>. По умолчанию — тёмная. */
function currentTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/** URL тайлов CARTO под тему (без политических плашек в attribution). */
function tileUrl(theme: "light" | "dark"): string {
  const isRetina = typeof window !== "undefined" && window.devicePixelRatio > 1;
  const r = isRetina ? "@2x" : "";
  const style = theme === "light" ? "light_all" : "dark_all";
  return `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}${r}.png`;
}

export default function LeafletMap({ lat, lng, radiusM, exact = false, height = 360 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const tileRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    let themeObserver: MutationObserver | null = null;

    ensureLeaflet().then(() => {
      if (cancelled || !ref.current || !window.L) return;
      const L = window.L;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      const approxMode = !exact && !!radiusM;
      const map = L.map(ref.current, {
        scrollWheelZoom: false,
        // В режиме "примерная область" не даём масштабироваться до улиц
        maxZoom: approxMode ? 12 : 19,
        minZoom: approxMode ? 9 : 3,
        zoomControl: !approxMode,
        attributionControl: true,
      }).setView([lat, lng], radiusM ? 12 : 15);
      mapRef.current = map;

      const addTiles = (theme: "light" | "dark") => {
        const layer = L.tileLayer(tileUrl(theme), {
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: "abcd",
          maxZoom: approxMode ? 12 : 19,
        });
        layer.addTo(map);
        tileRef.current = layer;
      };
      addTiles(currentTheme());
      // убираем дефолтную плашку "Leaflet" из attribution (оставляем только источники тайлов)
      if (map.attributionControl) {
        map.attributionControl.setPrefix(false);
      }

      if (exact) {
        L.marker([lat, lng]).addTo(map);
      }
      if (radiusM) {
        const circle = L.circle([lat, lng], {
          radius: radiusM,
          // в approx-режиме — никакой обводки и никакого визуального центра
          color: approxMode ? "transparent" : "#e50914",
          weight: approxMode ? 0 : 2,
          fillColor: "#e50914",
          fillOpacity: approxMode ? 0.18 : 0.12,
          interactive: false,
        }).addTo(map);
        map.fitBounds(circle.getBounds(), { padding: [20, 20] });
      }

      // Контейнер часто инициализируется до того, как получит реальную высоту
      // (условный рендер, вкладки, PWA). Без invalidateSize карта остаётся серой
      // или «пропадает» — пересчитываем размер после первого кадра.
      requestAnimationFrame(() => { if (!cancelled && mapRef.current) mapRef.current.invalidateSize(); });
      setTimeout(() => { if (!cancelled && mapRef.current) mapRef.current.invalidateSize(); }, 300);

      // Переключение темы сайта → меняем тайлы на лету, без пересоздания карты.
      themeObserver = new MutationObserver(() => {
        if (cancelled || !mapRef.current) return;
        if (tileRef.current) {
          mapRef.current.removeLayer(tileRef.current);
          tileRef.current = null;
        }
        addTiles(currentTheme());
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
    });

    return () => {
      cancelled = true;
      if (themeObserver) { themeObserver.disconnect(); themeObserver = null; }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      tileRef.current = null;
    };
  }, [lat, lng, radiusM, exact]);

  return <div ref={ref} className="leaflet-wrap" style={{ height }} />;
}
