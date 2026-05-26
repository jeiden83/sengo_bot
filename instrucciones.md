# 🌌 Guía de Reworks Próximos de PP - Sengo

Esta guía detalla el funcionamiento, parámetros y lógica interna de la funcionalidad de reworks de PP implementada para el bot **Sengo**.

---

## 🛠️ Comando `s.rework` / `/rework`

El comando permite proyectar cuánto PP dará un mapa con mods bajo un cambio de balanceo (rework) próximo o propuesto de osu!, ver la lista de reworks disponibles en la API de recalculación, o consultar el perfil recalculado de un jugador.

### Parámetros del Comando

El comando está integrado con el parseador general de argumentos (`argsParserNoCommand` y `argsParser`) y soporta:

1. **`s.rework [mapa] [+mods] [-rework <query>]`**:
   Calcula la estimación de PP de un mapa con mods bajo el rework indicado.
   - Si no se especifica mapa, tomará el último mapa del canal.
   - Si no se especifica `-rework`, utilizará el próximo rework a desplegarse (`master` para standard, `master_taiko` para taiko, o el último confirmado para otros modos).
   - *Ejemplo*: `s.rework +HDDT` o `s.rework 1816113 +HR -rework 198` o `/rework mapa:1816113 mods:HR rework:198`.

2. **`s.rework -lista` / `s.rework -list` / `/rework lista:true`**:
   Muestra un listado formateado en Discord con los reworks de la API divididos por estado:
   - **Próximo Deploy (CONFIRMED)**: Cambios confirmados listos para desplegarse.
   - **Propuestas (PROPOSED)**: Cambios bajo revisión y discusión activa.
   - **En Desarrollo (WIP)**: Cambios en fase inicial de experimentación.

3. **`s.rework -o [usuario] [-rework <query>]` / `/rework comparar:true usuario:[usuario]`**:
   Muestra las estadísticas del perfil de un usuario recalculadas en el rework indicado.
   - Compara el PP total, precisión media y el top play antes y después del rework.
   - Detalla las sub-métricas de PP (Aim, Tap, Acc, Reading, etc.).
   - Muestra el cambio de PP absoluto y porcentual.

---

## ⚙️ Arquitectura y Flujo de Trabajo

La funcionalidad está estructurada bajo el patrón MVC del bot:

### 1. Modelo: `models/ReworkModel.js`
- **Consulta de API**:
  - `https://pp.huismetbenen.nl/api/rework/list`: Lista los reworks activos.
  - `https://pp.huismetbenen.nl/api/rework/user/<rework_id>/<user_id>`: Obtiene el perfil recalculado del jugador.
  - `https://pp.huismetbenen.nl/api/rework/beatmap/<rework_id>/<beatmap_id>`: Obtiene las puntuaciones recalculadas en el beatmap.
- **Cálculo de Proyección**:
  - `calculateReworkPPForMap(...)`: Calcula las estrellas del mapa en vivo usando `rosu-pp-js`. Luego, busca una puntuación en el rework con los mismos mods o mods similares y calcula el ratio de ganancia/pérdida de PP. Aplica este ratio a los valores de PP del live para estimar los nuevos valores de PP a SS, 99%, 98% y 95%.
- **Persistencia y Caché Local**:
  - `rework_user_cache.json` se utiliza para persistir los perfiles recalculados y evitar consumir de más la API en consultas consecutivas. La caché expira automáticamente cada 24 horas.

### 2. Controlador: `commands/chat/osu/rework.js` y `commands/slash/rework.js`
- Parsean la entrada usando `argsParserNoCommand` y `argsParser`.
- Obtienen los datos del mapa/usuario a través de las utilidades de osu! de Sengo.
- Coordinan la obtención de datos del `ReworkModel` y delegan la visualización a la Vista.

### 3. Vista: `views/osuEmbeds.js` (Funciones añadidas)
- `doOsuReworkListEmbed`: Renderiza la lista de reworks con un estilo y colores premium.
- `doOsuReworkUserEmbed`: Renderiza la comparación del perfil en el rework, mostrando los campos detallados (Aim, Tap, etc.).
- `doOsuReworkMapEmbed`: Muestra la ficha técnica del mapa, el PP live contra el PP en rework, y colorea usando códigos ANSI de Discord (`\u001b[...]`) las ganancias (verde) o pérdidas (rojo) de PP.

---

## 🧪 Pruebas
Los archivos de pruebas de rework están ubicados en:
- **`scratch/test_rework_calc.js`**: Pruebas de integración del modelo de reworks.
- **`tests/test_rework_views.js`**: Pruebas de regresión visual de los embeds construidos.
- Integrados en el runner general de tests del bot (`tests/run_all_tests.js`).
