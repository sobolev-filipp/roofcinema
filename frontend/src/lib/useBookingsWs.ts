import { useEffect, useRef } from "react";
import { getToken } from "../api";

/** Подписка на WS-комнату конкретного показа. cb вызывается на любое событие
 * (created/updated). С отскоком если соединение упало — пробует переподключиться. */
export function useBookingsWs(screeningId: number | null | undefined, cb: () => void) {
  const cbRef = useRef(cb);
  cbRef.current = cb;

  useEffect(() => {
    if (!screeningId) return;
    let ws: WebSocket | null = null;
    let alive = true;
    let retry = 0;

    function connect() {
      if (!alive) return;
      const token = getToken();
      if (!token) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/api/ws/screenings/${screeningId}/bookings?token=${encodeURIComponent(token)}`;
      ws = new WebSocket(url);
      ws.onmessage = () => cbRef.current();
      ws.onclose = (ev) => {
        if (!alive) return;
        if (ev.code === 4401) return;  // не авторизован — не дёргаемся
        const delay = Math.min(15000, 1000 * 2 ** retry);
        retry++;
        setTimeout(connect, delay);
      };
    }
    connect();

    return () => {
      alive = false;
      try { ws?.close(); } catch {}
    };
  }, [screeningId]);
}
