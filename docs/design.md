# HabitApp — Diseño y UI

Estilo inspirado en LinkedIn: secciones de ancho completo con fondo blanco, separadas por 8px del fondo gris. La regla general evita tarjetas flotantes con sombra, pero no es absoluta: `HomeScreen` sí usa una tarjeta con sombra real (`listCard`, ver más abajo), además de la pantalla de login/registro.

## Sistema de colores

| Constante | Valor | Uso |
|---|---|---|
| BG | #F3F2EF | Fondo de pantalla (gris LinkedIn) |
| WHITE | #ffffff | Fondo de secciones / tarjetas |
| BLUE | #0A66C2 | Primario, botones, enlaces, tabs activos, iconos activos |
| TEXT | #1D2226 | Texto principal |
| GRAY | #666666 | Texto secundario, tabs inactivos |
| ORANGE | #f97316 | Hora límite `due_time` superada (hábito no completado) |
| HIGHLIGHT | #EEF3FB | Fondo de reacción emoji seleccionada en `ValidateHabitScreen` (`REACTION_BLUE_BG`). No se usa en RankingScreen — ver [navigation.md](navigation.md) |
| GREEN | #4CAF50 | Celebración de racha, estados validados |
| RED badge | #DC2626 | Punto rojo en escudo admin (badge de notificación) |
| — | #2E7D32 | Verde oscuro para textos de estado "completado" (HomeScreen, HabitStatsScreen) |
| — | #F0FAF0 | Fondo verde muy suave de tarjeta de hábito completado (HomeScreen, HabitStatsScreen) |
| — | #F9F9F9 | Fondo de la caja de nota en tarjetas (HabitStatsScreen, ValidateHabitScreen) |
| YELLOW | #F59E0B | Constante definida en RankingScreen (estado intermedio en week dots) |
| FLAME | #4CAF50 | Constante definida en RankingScreen para el icono de racha 🔥 (mismo valor que GREEN) |

## Componentes UI

**Botones primarios:** `height: 44`, `borderRadius: 4`, `backgroundColor: BLUE`, `alignSelf: 'center'`, `paddingHorizontal: 32`, `fontWeight: '600'`

**Botones destructivos / cerrar sesión:** solo texto `color: #CC0000`, sin fondo ni borde, `alignSelf: 'flex-start'`

**Separadores entre items:** `height: 1`, `backgroundColor: #E0E0E0`

**Secciones:** `backgroundColor: WHITE`, `paddingHorizontal: 16`, `marginBottom: 8`, sin `borderRadius` ni sombra

**Excepción — `listCard` (HomeScreen):** la tarjeta contenedora de la lista de hábitos sí usa sombra real (`shadowColor`, `shadowOpacity`, `shadowRadius`, `elevation`), a diferencia de la regla general de "sin sombra" de las demás secciones.
