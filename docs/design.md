# HabitApp — Diseño y UI

Estilo inspirado en LinkedIn: secciones de ancho completo con fondo blanco, separadas por 8px del fondo gris. Sin tarjetas flotantes con sombra (excepto en la pantalla de login/registro).

## Sistema de colores

| Constante | Valor | Uso |
|---|---|---|
| BG | #F3F2EF | Fondo de pantalla (gris LinkedIn) |
| WHITE | #ffffff | Fondo de secciones / tarjetas |
| BLUE | #0A66C2 | Primario, botones, enlaces, tabs activos, iconos activos |
| TEXT | #1D2226 | Texto principal |
| GRAY | #666666 | Texto secundario, tabs inactivos |
| ORANGE | #f97316 | Hora límite `due_time` superada (hábito no completado) |
| HIGHLIGHT | #EEF3FB | Fondo de fila del usuario en ActivityScreen |
| GREEN | #4CAF50 | Celebración de racha, estados validados |
| RED badge | #DC2626 | Punto rojo en escudo admin (badge de notificación) |

## Componentes UI

**Botones primarios:** `height: 44`, `borderRadius: 4`, `backgroundColor: BLUE`, `alignSelf: 'center'`, `paddingHorizontal: 32`, `fontWeight: '600'`

**Botones destructivos / cerrar sesión:** solo texto `color: #CC0000`, sin fondo ni borde, `alignSelf: 'flex-start'`

**Separadores entre items:** `height: 1`, `backgroundColor: #E0E0E0`

**Secciones:** `backgroundColor: WHITE`, `paddingHorizontal: 16`, `marginBottom: 8`, sin `borderRadius` ni sombra
