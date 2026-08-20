# Sengo

![](https://jeiden.s-ul.eu/9dtHHLhw)

Bot de Discord para [**osu!**](https://osu.ppy.sh/) enfocado en alta velocidad, automatización y funciones avanzadas para la comunidad. Inspirado en [**owo!**](https://github.com/AznStevy/owo-bot).

🔗 **[Para invitar a Sengo a tu servidor](https://discord.com/oauth2/authorize?client_id=1064201701210468454)**

> El servidor mencionado en algunos comandos es el [**Osu Latinoamerica!**](https://discord.gg/Ey2PYd4J73)

---

## 🚀 Requisitos e Instalación

### Requisitos
- **Node.js**: `22.x` o superior.
- **Git**

### Pasos de Instalación
1. Clona el repositorio:
   ```bash
   git clone https://github.com/jeiden83/sengo_bot
   cd sengo_bot
   ```

2. Instala las dependencias:
   ```bash
   npm install
   ```

3. Copia el archivo de variables de entorno y configúralo:
   ```bash
   cp .env.example .env
   ```

4. Rellena las variables de entorno en `.env`:

```env
# ==========================================
# Configuración de Discord
# ==========================================
DISCORD_TOKEN=tu_token_de_discord_aqui
CLIENT_ID=id_de_tu_cliente_aqui
BOT_PREFIX=s.

# ==========================================
# Configuración de osu! API v2
# ==========================================
OSU_CLIENT_ID=tu_id_de_cliente_osu_aqui
OSU_CLIENT_SECRET=tu_secreto_de_cliente_osu_aqui

# ==========================================
# Bases de Datos
# ==========================================
# Supabase (Base de datos principal)
SUPABASE_URL=tu_url_de_supabase_aqui
SUPABASE_KEY=tu_anon_key_de_supabase_aqui

# Turso / LibSQL (Base de datos de alto rendimiento para Snipes y Top Scores)
TURSO_DATABASE_URL=libsql://tu_base_de_datos.turso.io
TURSO_AUTH_TOKEN=tu_token_de_turso_aqui

# ==========================================
# Renderizado de Replays (o!rdr)
# ==========================================
# Opcional: Si no se provee o es 'true'/'false', se usará el modo simulado de desarrollo
ORDR_API_KEY=tu_api_key_de_ordr_aqui
ORDR_DEV_MODE=false

# ==========================================
# Integraciones y APIs Externas (Opcionales)
# ==========================================
# Tatsu API (para otorgar experiencia en Starboard)
TATSU_API_KEY=tu_tatsu_key_aqui

# Groq API (para análisis inteligente con IA de torneos y hojas de cálculo)
GROQ_API_KEY=tu_api_key_de_groq_aqui

# Token de GitHub (para webhooks de commits)
GITHUB_TOKEN=tu_token_de_github_aqui

# Huismetbenen (para el comando de Reworks de PP)
HUISMETBENEN_ACCESS_TOKEN=tu_token_de_huismetbenen_aqui
HUISMETBENEN_REFRESH_TOKEN=tu_token_de_refresh_huismetbenen_aqui

# ==========================================
# IDs Maestras de Discord
# ==========================================
OWNER_ID=tu_discord_id_aqui
SENGOBOT_GUILD_ID=tu_guild_id_aqui

# ==========================================
# Configuración de Despliegue (OAuth y Webhooks)
# ==========================================
PORT=3000
RENDER=false
RENDER_EXTERNAL_URL=https://tu-url-de-render-o-ngrok.com
START_NGROK=false

# Token de apagado remoto seguro (requerido para despliegues en Render)
SHUTDOWN_TOKEN=tu_token_de_apagado_aqui

# Webhook de errores críticos (Opcional)
ERROR_WEBHOOK_URL=url_de_tu_webhook_de_errores_aqui
```

5. Inicia Sengo:
   ```bash
   node .
   ```

---

## 📖 Guía de Comandos de Sengo

Sengo responde tanto a comandos de chat clásicos con prefijo (`s.`) como a comandos de barra diagonal (**Slash Commands**).

---

### 🎮 Comandos de osu!

#### 👤 Perfil y Jugadas
* **`s.osu` o `s.o [usuario]`**
  Muestra el perfil general de un jugador en osu!, con estadísticas de Ranked Play, PP, precisión, medallas, nivel y tiempo de juego.
  * *Flags:*
    * `-d` o `-detail`: Muestra el perfil completo con grados y estadísticas avanzadas.
    * `-std` / `-taiko` / `-ctb` / `-mania`: Cambia el modo de juego.
    * `-bancho` / `-gatari`: Cambia el servidor consultado.
* **`s.rs [usuario]` (Recent Score)**
  Muestra la jugada más reciente del usuario.
  * *Flags:*
    * `-d` o `-detail`: Muestra detalles completos (aciertos, fallos, UR, etc.).
    * `-l` o `-list`: Muestra la lista de las últimas 5 jugadas.
    * `-b` o `-pp`: Ordena las jugadas recientes por PP.
    * `-std` / `-taiko` / `-ctb` / `-mania`: Cambia el modo de juego.
* **`s.top [usuario]`**
  Muestra las mejores jugadas (Top Plays) de un usuario con filtrado interactivo.
  * *Flags y Filtros:*
    * `-i <índice>`: Muestra el embed individual de una jugada específica (ej: `s.top -i 5`).
    * `+<mods>` o `-m <mods>`: Filtra por mods exactos (ej: `+HDHR`, `+NM`).
    * `-mx <mods>`: Filtra por mods contenidos (ej: `-mx HR`).
    * `-? "<búsqueda>"`: Filtra por título, artista o dificultad (ej: `-? "last goodbye"`).
    * `-g <pp>` o `-pp <pp>`: Filtra por umbral de PP mínimo (ej: `-g 300`).
    * `-r`: Ordena por fecha (más recientes primero).
    * `-c`: Ordena por combo máximo.
    * `-acc`: Ordena por precisión.
    * `-p <página>`: Navega a una página específica.
    * `-std` / `-taiko` / `-ctb` / `-mania`: Cambia el modo de juego.
* **`s.c` o `s.compare [usuario]`**
  Compara las puntuaciones del usuario en el último mapa consultado en el canal.
  * *Flags:*
    * `-i <índice>`: Muestra el embed detallado de la puntuación en ese índice.
    * `+<mods>` / `-m <mods>`: Filtra por mods exactos.
    * `-mx <mods>`: Filtra por mods contenidos.
    * `-g <pp>`: Filtra puntuaciones con PP mayor o igual al valor.
    * `-ps`: Filtra mostrando solo jugadas completadas (passes).
    * `-p <página>`: Navega a una página específica.
* **`s.lazer` y `s.classic`**
  Alterna el cálculo y visualización de un embed de jugada reciente entre la puntuación estandarizada de **Lazer** (máx. 1M) y **Classic Score**.
  * *Uso:* Ejecutar `s.lazer` o `s.classic` respondiendo a un embed de jugada o enviándolo directamente tras una score.
* **`s.sim [mapa] [+mods] [acc%] [combox] [missesm]`**
  Simulador avanzado de jugadas y cálculo de PP para cualquier mapa. Permite proyectar puntuaciones personalizando parámetros.
  * *Ejemplos:*
    * `s.sim +HDDT 98.5% 1200x 2m`
    * `s.sim 99.2% 5x100 1x50`
* **`s.subir`**
  Sube y calcula los datos detallados de una jugada a partir de un archivo `.osr` adjunto o respondiendo a un embed de score compatible.
  * *Flags:* `-m <mods>` para sobrescribir o forzar mods detectados (ej: `-m HDDT`, `-m NM`).
* **`s.replay`**
  Analizador técnico de archivos `.osr` adjuntos.
* **`s.render`**
  Renderiza a vídeo una replay de osu! estándar (`.osr`) enviada o referenciada a través de [o!rdr](https://ordr.issou.best/).
  * *Flags:*
    * `-skin [nombre]`: Utiliza una skin específica del catálogo.
    * `-res [1280x720|1920x1080]`: Configura la resolución del vídeo.
    * `-config`: Consulta o configura tu preset predeterminado de renderizado.

---

#### 🏆 Competitivo, Rankings y Estadísticas
* **`s.lb` o `s.leaderboard`**
  Muestra la tabla de clasificación global o nacional del último mapa consultado.
  * *Flags:*
    * `-pais [código]`: Muestra el leaderboard del país indicado (o autodetecta el tuyo si estás vinculado).
    * `+<mods>` / `-m <mods>`: Filtra por combinación de mods.
    * `-stable` / `-lazer`: Alterna entre rankings clásicos o estandarizados de lazer.
    * `-std` / `-taiko` / `-ctb` / `-mania`: Cambia el modo de juego.
* **`s.snipes [usuario]`**
  Monitoreo de tops nacionales (#1s del país), rivales y estadísticas de francotirador.
  * *Modos y Flags:*
    * `s.snipes`: Resumen general con gráfico de barras por dificultad.
    * `s.snipes -d`: Perfil detallado de habilidad (estrellas, mappers más jugados, stats técnicos e hitos).
    * `s.snipes -nemesis`: Análisis de rivales (a quién has snipeado y quién te ha snipeado).
    * `s.snipes -top`: Lista paginada interactiva de tus #1s nacionales.
      * *Filtros en `-top`:* `-sr>5 -sr<8` (rango de estrellas), `+<mods>`, `-? "<texto>"`, `-g <pp>`, `-r`, `-c`, `-acc`, `-i <n>`.
* **`s.nacional [código/nombre]`**
  Muestra la tabla de clasificación por PP de un país específico.
  * *Flags:* `-acc` (ordena por precisión), `-regional [región]`, `-std` / `-taiko` / `-ctb` / `-mania`.
* **`s.regional [región]`**
  Consulta clasificaciones regionales de [osu!World](https://osuworld.octo.moe/).
  * *Flags:* `lista` (muestra regiones disponibles), `-pais [código]`.
* **`s.gap`**
  Muestra la brecha (gap) y diferencia exacta de puntuación, precisión y PP de los usuarios del servidor en el último mapa consultado.
  * *Flags:* `-p <página>`, `-force` (fuerza actualización desde la API), `$reply` (aplica sobre el mapa del mensaje respondido).
* **`s.entre [jugador1] [jugador2]`**
  Compara cara a cara las estadísticas generales (PP, rango, precisión, nivel, tiempo de juego, medallas) entre dos jugadores y calcula quién domina en más categorías.
* **`s.ranked` o `s.rk [usuario]`**
  Estadísticas de Ranked Play (matchmaking de lazer) de un usuario (ELO/rating, victorias, partidas jugadas, winrate).
  * *Flags:* `-top` (clasificación global), `-server` (clasificación del servidor), `-wins` / `-winrate` / `-plays`.
* **`s.amigos`**
  Compara y muestra el ranking entre tus amigos mutuals de osu! agregados a Sengo.
  * *Flags:* `-p <página>`, `-pais <código|self>`, `-std` / `-taiko` / `-ctb` / `-mania`.

---

#### 🗺️ Mapas, Recomendaciones y Rendimiento
* **`s.m` o `s.map [id_mapa] [+mods]`**
  Calcula y muestra estadísticas detalladas y valores de PP ajustados a mods de cualquier beatmap. Si no se provee ID, busca en el historial del canal.
  * *Flags:* `+<mods>` / `-m <mods>`, `-mapset` (muestra dificultades del mapset), `-std` / `-taiko` / `-ctb` / `-mania`.
* **`s.recommend` o `s.rec`**
  Recomendador inteligente de mapas de rendimiento (farm/PP) adaptados a tu estilo de juego.
  * *Flags:*
    * `-pp <valor|rango>`: Filtra por PP objetivo (ej: `-pp 300` o `-pp 250-300`).
    * `-mods <mods>`: Filtra por mods específicos (ej: `-mods HDDT`).
    * `-jugados`: Incluye mapas que ya estén en tu Top 100.
    * `-force`: Fuerza la recarga ignorando la caché.
* **`s.rework`**
  Estima el PP de mapas o compara el perfil de un usuario frente a los reworks próximos de PP calculados por [pp.huismetbenen.nl](https://pp.huismetbenen.nl/).
  * *Flags:* `-lista` (lista reworks activos), `-top` (top 5 recalculado), `[mapa] +mods` (estima PP del mapa bajo el rework).
* **`s.daily`**
  Muestra el Daily Challenge activo, mapa, estrellas, tiempo restante y top 3 de jugadas.
* **`s.bg`**
  Envía el fondo (background) en alta resolución del último mapa del canal o del ID especificado.

---

#### 🛠️ Mapeo, Comunidad y Tracking
* **`s.mapper` o `s.mappers [usuario]`**
  Estadísticas detalladas de creador/mapper (seguidores, Kudosu, mapas rankeados, amados, graveyard, guest diffs y nominaciones), top de mappers y Beatmap Nominators.
  * *Flags:*
    * `-top`: Clasificación de mappers (filtros: `-pais [código]`, `-server`, `-mode <modo>`, `-kudosus`, `-ranked`, `-gd`, `-followers`, etc.).
    * `-bn`: Lista de Beatmap Nominators (BN) de Mappers' Guild.
    * **Mapping Tracker:**
      * `s.mapper -track -canal #canal`: Configura el canal de notificaciones automáticas de mapas.
      * `s.mapper -track -canal`: Deshabilita el tracking en el servidor.
      * `s.mapper -track -usuario <ID/mención>`: Añade un mapper al tracking.
      * `s.mapper -track -usuario -server`: Añade masivamente a todos los mappers vinculados del servidor.
      * `s.mapper -track -test`: Envía una notificación de prueba en el canal configurado.
* **`s.queue [usuario]`**
  Sistema de Modding Queue para mappers.
  * *Subcomandos:*
    * `s.queue`: Consulta tu queue o la de otro usuario.
    * `s.queue -set <mensaje>`: Define el mensaje de tu queue.
    * `s.queue -link <url>`: Agrega un enlace de formulario/detalles.
    * `s.queue -linkname <nombre>`: Texto descriptivo del enlace.
    * `s.queue -abrir` / `-cerrar`: Cambia el estado de la queue.
    * `s.queue -modo <STD/MANIA/etc.>`: Modos aceptados.
    * `s.queue -server`: Muestra los mappers con queue abierta en el servidor actual.
    * `s.queue -borrar`: Elimina tu queue.
* **`s.torneos`**
  Búsqueda, desglose interactivo por IA y feed de torneos de osu!.
  * *Flags:*
    * `s.torneos [-modo <modo>] [-rango <rango>] [-tag <tag>] [-pasados] [-estado <estado>]`: Búsqueda interactiva con filtros.
    * `s.torneos -canal #canal`: Configura el canal para recibir el feed automático de nuevos torneos (Admin).
    * `s.torneos -canal -borrar`: Desactiva el feed de torneos en el servidor.
* **`s.track`**
  Sistema de tracking de Top Plays en vivo para servidores de Discord.
  * *Subcomandos (Requiere Administrador):*
    * `s.track canal #canal`: Configura el canal para anuncios automáticos de jugadas.
    * `s.track canal quitar`: Desactiva el canal de tracking.
    * `s.track add <usuario_osu>`: Añade un jugador al tracking del servidor.
    * `s.track remove <usuario_osu>`: Elimina un jugador del tracking.
    * `s.track list`: Lista todos los jugadores monitoreados en el servidor.
* **`s.populate` o `s.pop`**
  Sistema distribuido para colaborar poblando la base de datos de #1s nacionales de Sengo.
  * *Opciones:*
    * `s.populate <PAÍS>`: Inicia una sesión de trabajador con instrucciones para PowerShell (Windows).
    * `s.populate <PAÍS> -movil` (o `-mobile`, `-web`): Genera una sesión web interactiva (móvil/PC).
    * `s.populate <PAÍS> -bash`: Genera instrucciones para Bash (Linux/Mac/Termux).
    * `s.populate -lista`: Muestra el estado de avance y puestos libres por país.
    * `s.populate -top`: Tabla de clasificación de colaboradores.
* **`s.skin [@usuario]`**
  Vincula y comparte tu skin personalizada de osu!.
  * *Subcomandos:*
    * `s.skin -set <enlace> [-nombre <nombre>] [-osu|-ctb|-taiko|-mania]`: Vincula tu skin.
    * `s.skin -nombre <nombre>`: Cambia el nombre de tu skin.
    * `s.skin -delete [-osu|-ctb|-taiko|-mania]`: Elimina tu skin vinculada.
* **`s.link`**
  Vincula tu cuenta de osu! con tu usuario de Discord.
  * *Opciones:*
    * `s.link`: Envía el enlace oficial de autorización segura por OAuth 2.0 por mensaje privado.
    * `s.link -chat [usuario]`: Vinculación tradicional pública por chat.
    * `s.link unlink`: Desvincula tu cuenta de Discord de Sengo.
* **`s.pais` / `s.digitos` / `s.identidad`**
  Asignación automática de roles según tu cuenta de osu! vinculada (exclusivo para servidores compatibles como **Osu! Latinoamérica**):
  * `s.pais`: Asigna el rol de país.
  * `s.digitos`: Asigna el rol de dígitos según tu ranking global.
  * `s.identidad`: Asigna simultáneamente ambos roles (país y dígitos).

---

### 🛠️ Utilidades y Sistema

* **`s.language [es|en]` o `s.idioma`**
  Configura el idioma de Sengo para el servidor (`es` para Español, `en` para Inglés). Requiere permisos de Administrador. Usa `s.language list` para ver los idiomas disponibles.
* **`s.bug <texto>`**
  Envía un reporte de bug directamente a los desarrolladores. Soporta adjuntos de imágenes y responder a mensajes con errores.
* **`s.sugerencia <texto>`**
  Envía una propuesta de mejora o nueva función directamente a los desarrolladores.
* **`s.bcv [moneda]`**
  Muestra la tasa oficial de cambio del Banco Central de Venezuela (USD, EUR, CNY, etc.).
* **`s.binance [par]`**
  Muestra el precio en tiempo real de criptomonedas o el promedio de Binance P2P.
* **`s.brecha`**
  Calcula la brecha cambiaria en bolívares entre la tasa oficial del BCV y el mercado P2P de Binance.
* **`s.emojis`**
  Herramienta para listar, inspeccionar y exportar emojis del servidor (Owner / Admins).
* **`s.ping`**
  Muestra la latencia actual del bot con Discord.
* **`s.roll [rango]`**
  Genera un número entero aleatorio (ej: `s.roll 1-100`).
* **`s.tag [nombre]`**
  Guarda y reproduce textos o enlaces rápidos en el servidor.
* **`s.say [texto]`**
  Hace que Sengo repita el mensaje indicado.

---

### 🛡️ Moderación y Administración

* **`s.giveaway` o `s.sorteo`**
  Sistema interactivo para crear y gestionar sorteos en el servidor con verificación **Demostrablemente Justa** (*Provably Fair* con Hash SHA-256).
  * *Subcomandos:*
    * `crear <#canal> <ganadores> <tiempo> <premio>`: Inicia el creador interactivo.
    * `terminar <mensaje_id|enlace>`: Finaliza un sorteo activo y elige ganadores.
    * `reroll <mensaje_id|enlace>`: Vuelve a seleccionar ganadores de un sorteo concluido.
* **`s.cumple`**
  Gestión interactiva del calendario de cumpleaños del servidor y felicitaciones automáticas diarias.
  * *Uso:* `s.cumple [DD/MM]`, `s.cumple lista`, `s.cumple proximo`, `s.cumple canal #canal` (Admin).
* **`s.rol`**
  Gestión administrativa de roles y colores.
  * *Uso:* `s.rol color <rol_id> <hex>`, `s.rol otorgar <rol_id> <user_id>`, `s.rol otorgarTodos <rol_id>`.
* **`s.star`**
  Configura y procesa manualmente la función de *Starboard* (mensaje más votado del día anterior) con asignación de experiencia de Tatsu.
* **`s.github`**
  Permite a los administradores registrar canales para recibir notificaciones por webhook de nuevos commits en repositorios de GitHub.
  * *Uso:* `s.github colocar [#canal]`, `s.github borrar [#canal]`.
* **`s.blacklist`**
  Gestión de lista negra para restringir el acceso a comandos de Sengo a usuarios específicos (Solo Administradores).

---

### 🌸 Memes y Comunidad

* **`s.fumo`**: Foto y datos aleatorios de un Fumo de Touhou.
* **`s.yuri`**: Muestra imágenes temáticas de Yuri (`-details`, `-stats`).
* **`s.globo`**: Añade un meme de globo de diálogo tipo cómic a una imagen adjunta o mencionada.
* **`s.jeiden` / `s.femboy` / `s.oye` / `s.sex`**: Reacciones y chistes clásicos de la comunidad.

---

### ℹ️ Información

* **`s.help` o `s.h [comando]`**: Menú de ayuda interactivo con paginación y búsqueda por comando.
* **`s.acerca` o `s.about`**: Presentación interactiva y detalles técnicos sobre la arquitectura de Sengo.
* **`s.contribuidores` o `s.con`**: Lista de usuarios de la comunidad vinculados mediante OAuth organizados por país con su estado de supporter (`-force` para sincronizar).
* **`s.donadores`**: Lista de usuarios que apoyan económicamente el desarrollo del bot.
