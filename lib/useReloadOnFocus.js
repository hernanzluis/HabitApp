// Recarga común de las pantallas de pestaña que muestran datos que cambian
// por fuera (Validar, Inicio, Actividad). Las pestañas no se desmontan al
// cambiar de pestaña ni al ir a segundo plano, así que cargar solo "al
// enfocar" deja datos viejos cuando la pantalla ya era la activa.
//
// Recarga:
//   - al enfocar la pantalla (como el useFocusEffect de antes);
//   - al volver a primer plano, si está enfocada y la última carga tiene más
//     de FOREGROUND_MIN_MS;
//   - al tocar una notificación que navega a ella: RootNavigator pasa el
//     parámetro `pushAt` (marca de tiempo) y la pantalla lo entrega aquí como
//     `reloadToken`. Esa recarga se hace siempre, salvo que ya haya una carga
//     empezada después del toque (la del propio enfoque).
// Nunca lanza una carga si ya hay otra en curso; la de una notificación, en
// ese caso, se encola para cuando termine.
//
// `load({ background })`: background = true en las recargas que no vienen de
// entrar en la pantalla (primer plano, notificación), para que la pantalla
// use su indicador discreto (el de deslizar para actualizar) en vez del
// de carga a pantalla completa.
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';

const FOREGROUND_MIN_MS = 30 * 1000;

export function useReloadOnFocus(load, reloadToken) {
  const isFocused = useIsFocused();
  const loadRef = useRef(load);
  loadRef.current = load;
  const inFlight = useRef(false);
  const queued = useRef(false);
  const lastStartAt = useRef(0);

  const run = useCallback(async ({ background = false, queueIfBusy = false } = {}) => {
    if (inFlight.current) {
      if (queueIfBusy) queued.current = true;
      return;
    }
    inFlight.current = true;
    lastStartAt.current = Date.now();
    try {
      await loadRef.current({ background });
    } finally {
      inFlight.current = false;
      if (queued.current) {
        queued.current = false;
        run({ background: true });
      }
    }
  }, []);

  useFocusEffect(useCallback(() => { run(); }, [run]));

  useEffect(() => {
    if (!isFocused) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastStartAt.current >= FOREGROUND_MIN_MS) {
        run({ background: true });
      }
    });
    return () => sub.remove();
  }, [isFocused, run]);

  useEffect(() => {
    if (!reloadToken) return;
    // La carga del enfoque, si la notificación acaba de traernos aquí, ya
    // empezó después del toque: no hace falta otra.
    if (lastStartAt.current >= reloadToken) return;
    run({ background: true, queueIfBusy: true });
  }, [reloadToken, run]);
}
