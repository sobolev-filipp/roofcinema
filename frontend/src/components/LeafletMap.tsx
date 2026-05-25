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

export default function LeafletMap({ lat, lng, radiusM, exact = false, height = 360 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
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
      }).setView([lat, lng], radiusM ? 12 : 15);
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: approxMode ? 12 : 19,
      }).addTo(map);

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
    });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [lat, lng, radiusM, exact]);

  return <div ref={ref} className="leaflet-wrap" style={{ height }} />;
}
