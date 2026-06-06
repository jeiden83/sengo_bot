# Sengo bot

![](https://jeiden.s-ul.eu/9dtHHLhw)

Bot de Discord para [**osu!**](https://osu.ppy.sh/) hecho para suplir algunas carencias de los actuales. Inspirado en el [**owo!**](https://github.com/AznStevy/owo-bot) 

🔗 **[Invita a Sengo a tu servidor](https://discord.com/oauth2/authorize?client_id=1064201701210468454)**

> El servidor mencionado en algunos comandos es el [**Osu Latinoamerica!**](https://discord.gg/Ey2PYd4J73) 

## Instalacion
- Crea una carpeta y clona el repositorio con:

```bash
git clone https://github.com/jeiden83/sengo_bot
``` 
- Instala las dependencias:
```bash
npm install
```

- Copia y renombra el archivo `.env.example` a `.env` en la raíz del proyecto, y rellena las variables de entorno necesarias:

```env
# Configuración de Discord
DISCORD_TOKEN=tu_token_de_discord_aqui
CLIENT_ID=id_de_tu_cliente_aqui
BOT_PREFIX=s.

# Configuración de osu! API
OSU_CLIENT_ID=tu_id_de_cliente_osu_aqui
OSU_CLIENT_SECRET=tu_secreto_de_cliente_osu_aqui

# Configuración de Supabase
SUPABASE_URL=tu_url_de_supabase_aqui
SUPABASE_KEY=tu_anon_key_de_supabase_aqui

# Configuración de Tatsu (Opcional - para ganar score de Tatsu)
TATSU_API_KEY=tu_tatsu_key_aqui

# IDS Maestras de Discord
OWNER_ID=tu_discord_id_aqui
SENGOBOT_GUILD_ID=tu_guild_id_aqui

# Token de GitHub para repositorios (Opcional - para estadísticas de webhook)
GITHUB_TOKEN=tu_token_de_github_aqui

# Configuración de Despliegue (OAuth, Webhooks y Desarrollo Local)
PORT=3000
RENDER=false
RENDER_EXTERNAL_URL=https://tu-url-de-render-o-ngrok.com
START_NGROK=false

# Token de apagado remoto seguro (Requerido para despliegues continuos en Render)
SHUTDOWN_TOKEN=tu_token_de_apagado_aqui

# Webhook de errores críticos (Opcional)
ERROR_WEBHOOK_URL=url_de_tu_webhook_de_errores_aqui

# Token de Huismetbenen (Opcional - requerido para la funcionalidad de Rework de PP)
HUISMETBENEN_ACCESS_TOKEN=tu_token_de_huismetbenen_aqui
```

- Correr el bot:
```bash
node .
```
- Disfruta flexear al Sengo bot. 
- *(Opcional)* Avisarle a `jeiden83` de que has hecho todo hasta aqui.

## Guía de Comandos del Sengo

El bot responde tanto a comandos de chat clásicos (usando el prefijo configurado, por ejemplo, `s.`) como a comandos de barra diagonal (Slash Commands).

### 🎮 Comandos de osu!

*   **`s.osu` o `s.o [usuario]`**
    Muestra el perfil general de un jugador de osu!, incluyendo estadísticas de Ranked Play, PP, precisión, medallas, nivel y tiempo de juego.
    *   *Parámetros y flags útiles:*
        *   `-d` o `-detail`: Muestra el perfil completo junto a las estadísticas y grados detallados.
        *   `-std` / `-taiko` / `-ctb` / `-mania`: Cambia el modo de juego consultado (estándar, taiko, catch o mania).
        *   `-bancho` / `-gatari`: Cambia el servidor consultado (por defecto Bancho).
*   **`s.rs [usuario]` (Recent Score)**
    Muestra la jugada más reciente del usuario.
    *   *Parámetros y flags útiles:*
        *   `-d` o `-detail`: Muestra detalles completos de la jugada (aciertos, fallos, UR, etc.).
        *   `-l` o `-list` o `-lista`: Muestra una lista de las últimas 5 jugadas del usuario.
        *   `-b` o `-pp`: Ordena las jugadas recientes por cantidad de PP en lugar de fecha.
        *   `-std` / `-taiko` / `-ctb` / `-mania`: Cambia el modo de juego consultado.
*   **`s.top [usuario]`**
    Muestra los mejores registros (Top Plays) del usuario.
    *   *Parámetros y filtros:*
        *   `-i <índice>` o `-i<índice>`: Muestra una sola jugada específica del top (ej: `s.top -i 5`).
        *   `+<mods>` o `-m <mods>`: Filtra jugadas hechas exactamente con esa combinación de mods (ej: `+HDHR`, `-m HDHR`, `+NM` para Nomod).
        *   `-mx <mods>`: Filtra jugadas que contengan esos mods (ej: `-mx HR`).
        *   `-? "<búsqueda>"`: Filtra mapas por título, artista o nombre de dificultad (ej: `-? "last goodbye"`).
        *   `-g <pp>` o `-pp <pp>`: Filtra y cuenta jugadas con esa cantidad o más de PP (ej: `-g 300`).
        *   `-r`: Ordena las jugadas por fecha (más recientes primero) en lugar de por PP.
        *   `-c`: Ordena las jugadas por el combo máximo alcanzado.
        *   `-acc`: Ordena las jugadas por la precisión más alta.
        *   `-p <página>` o `-page <página>`: Navega a una página específica de la lista del top (ej: `s.top -p 2`).
        *   `-std` / `-taiko` / `-ctb` / `-mania`: Cambia el modo de juego consultado.
*   **`s.ranked` o `s.rk [usuario]`**
    Muestra estadísticas de Ranked Play (matchmaking de lazer) de un usuario (ELO/rating, victorias, partidas jugadas, winrate, etc.).
    *   *Parámetros y filtros:*
        *   `-top`: Muestra la clasificación global de Ranked Play.
        *   `-server` o `-srv`: Muestra la clasificación de los usuarios vinculados en el servidor actual.
        *   `-wins` / `-winrate` / `-plays`: Cambia el criterio de ordenamiento de la clasificación (por defecto ordena por ELO/rating).
*   **`s.c` o `s.compare`**
    Compara las puntuaciones locales del usuario en el último mapa mostrado en el canal de Discord.
    *   *Parámetros y filtros:*
        *   `-i <índice>`: Muestra un embed detallado de la puntuación en ese índice de la lista de comparación.
        *   `+<mods>` o `-m <mods>`: Filtra por combinación de mods exacta.
        *   `-mx <mods>`: Filtra por mods contenidos.
        *   `-g <pp>` o `-pp <pp>`: Filtra puntuaciones con PP mayor o igual al valor.
        *   `-ps`: Filtra mostrando únicamente jugadas completadas (pasadas).
        *   `-p <página>`: Navega a una página específica de la lista de comparación.
        *   `-std` / `-taiko` / `-ctb` / `-mania`: Cambia el modo de juego consultado.
*   **`s.subir`**
    Sube y calcula los datos detallados de una jugada a partir de un archivo `.osr` o un embed compatible.
    *   *Parámetros y flags útiles:*
        *   `-m <mods>` o `-mods <mods>`: Sobrescribe o fuerza los mods detectados (ej: `-m HDDT`). Usar `-m NM` para No Mod.
*   **`s.lb` o `s.leaderboard`**
    Muestra la tabla de clasificación general.
    *   *Parámetros y flags útiles:*
        *   `-pais [código/nombre]`: Filtra la tabla por país (ej: `-pais VE`).
        *   `-std` / `-taiko` / `-ctb` / `-mania`: Cambia el modo de juego consultado.
*   **`s.nacional [código/nombre]`**
    Muestra la tabla de clasificación por Performance Points (pp) de un país específico.
    *   *Parámetros y filtros:*
        *   `-acc`: Ordena la tabla por precisión en lugar de PP.
        *   `-regional [región]`: Muestra la tabla de clasificación de una subdivisión o estado del país.
        *   `-std` / `-taiko` / `-ctb` / `-mania`: Cambia el modo de juego consultado.
*   **`s.regional [región]`**
    Atajo directo para mostrar la clasificación regional de [osu!World](https://osuworld.octo.moe/) del jugador o de una subdivisión específica.
    *   *Parámetros y filtros:*
        *   `lista`: Lista todas las regiones/subdivisiones disponibles del país.
        *   `-pais [código/nombre]`: Especifica el país del que se consultan las regiones.
        *   `-std` / `-taiko` / `-ctb` / `-mania`: Cambia el modo de juego consultado.
*   **`s.pais`**
    Asigna de forma automática el rol correspondiente a tu país de osu! (exclusivo para el servidor de **Osu! Latinoamérica**).
*   **`s.gap`**
    Muestra la brecha (gap) y diferencia exacta de puntuación, precisión y PP de los usuarios vinculados del servidor en el último beatmap consultado.
    *   *Parámetros y flags útiles:*
        *   `-p <página>`: Navega por la lista de scores del servidor.
        *   `-force`: Fuerza la actualización de puntuaciones desde la API de osu!.
        *   `$reply`: Ejecuta el comando para el beatmap del mensaje al que se responde.
*   **`s.entre [jugador1] [jugador2]`**
    Compara las estadísticas generales (PP, Rank, Acc, Playcount, Playtime, Medallas, Nivel) de dos jugadores en osu! y determina quién gana la mayoría.
    *   *Parámetros y flags útiles:*
        *   `[jugador1] [jugador2]`: Nombre de usuario de osu! o mención de Discord de los jugadores a comparar. Si solo se especifica uno, se comparará contra ti.
        *   `-std` / `-taiko` / `-ctb` / `-mania`: Cambia el modo de juego para la comparación.
        *   `-gatari` / `-bancho`: Cambia el servidor de osu! consultado.
*   **`s.amigos`**
    Compara y muestra el ranking entre tus amigos mutuals agregados al bot.
    *   *Parámetros y flags útiles:*
        *   `-p <página>`: Navega por la tabla de posiciones de tus amigos.
        *   `-std` / `-taiko` / `-ctb` / `-mania`: Filtra la tabla por ese modo de juego.
*   **`s.mapper` o `s.creator`**
    Muestra estadísticas detalladas de creador/mapper de un usuario en osu! (seguidores, Kudosu, mapas por categoría, nominaciones, etc.).
    *   *Parámetros y filtros:*
        *   `[usuario]`: Especifica el usuario de osu!. Si no se provee, muestra tu propio perfil.
        *   `-rankeados` / `-pending` / `-loved` / `-graveyard` / `-gd`: Filtra y muestra la lista interactiva de mapas en esa categoría.
        *   `-top`: Muestra la tabla de clasificación de mappers.
            *   *Flags de `-top`:*
                *   `-pais [código]` o `-country [código]`: Filtra la tabla por país (ej: `MX`, `VE`).
                *   `-server` o `-servidor`: Muestra solo los mappers del servidor de Discord actual.
                *   `-std` / `-taiko` / `-ctb` / `-mania` o `-mode <modo>`: Filtra por su modo de juego principal.
                *   `-kudosus` / `-gd` / `-ranked` / `-wip` / `-loved` / `-followers` / `-graveyard` / `-recent`: Cambia el criterio de ordenamiento de la tabla.
*   **`s.link [-oauth]`**
    Vincula tu cuenta de osu! a tu Discord. El uso de `-oauth` te enviará un mensaje privado con un enlace web seguro de autorización oficial.
*   **`s.bg`**
    Muestra la imagen de fondo (background) del último mapa enviado en el chat.
*   **`s.replay`**
    Analiza un archivo `.osr` adjunto de replay y muestra sus estadísticas.
*   **`s.digitos` o `s.digits`**
    Asigna de forma automática el rol correspondiente a la cantidad de dígitos de tu rango global de osu! (exclusivo para el servidor de **Osu! Latinoamérica**).
*   **`s.daily`**
    Muestra la información y el mapa del Daily Challenge activo, el tiempo restante para completarlo y el top 3 de puntuaciones.
    *   *Parámetros y flags útiles:*
        *   `-std` / `-taiko` / `-ctb` / `-mania`: Filtra el Daily Challenge por ese modo de juego.
*   **`s.m` o `s.map` o `s.mapa`**
    Calcula y muestra estadísticas detalladas y valores de PP ajustados a mods de cualquier beatmap. Si no se indica ID, busca en el historial del canal.
    *   *Parámetros y flags útiles:*
        *   `+<mods>` o `-m <mods>`: Simula y calcula la dificultad y el PP del mapa con esa combinación de mods (ej: `+HDDT`).
        *   `-std` / `-taiko` / `-ctb` / `-mania`: Cambia o fuerza el modo de juego para el mapa.
*   **`s.recommend` o `s.rec` o `s.recomendar`**
    Recomienda mapas de rendimiento (farm/PP) personalizados basándose en tu nivel y estilo de juego.
    *   *Parámetros útiles:*
        *   `-pp <valor/rango>`: Filtra por un PP objetivo (ej: `-pp 300` o `-pp 250-300`).
        *   `-mods <mods>`: Filtra por mods específicos (ej: `-mods HDDT`).
        *   `-jugados` o `-played`: Incluye mapas que ya has jugado en tu Top 100.
        *   `-std` / `-taiko` / `-ctb` / `-mania`: Cambia el modo de juego para la recomendación.
*   **`s.rework`**
    Estima el PP del último mapa o compara las estadísticas de un usuario frente a un Rework próximo de PP, consumiendo los datos desde [pp.huismetbenen.nl](https://pp.huismetbenen.nl/).
    *   *Uso común:*
        *   `s.rework -lista`: Muestra todos los reworks disponibles.
        *   `s.rework -top`: Muestra tu top 5 recalculado en el rework.
        *   `s.rework [mapa] +mods`: Estima el PP que dará el mapa bajo el rework.
*   **`s.snipes [usuario]`**
    Muestra estadísticas nacionales del usuario (tops nacionales, mods más usados, etc.) desde la web `snipe.huismetbenen.nl`.

### 🛠️ Utilidades

*   **`s.bcv [moneda]`**
    Muestra la tasa oficial de cambio del Banco Central de Venezuela (soporta dolar, euro, yuan, etc.).
*   **`s.binance [par]`**
    Muestra el precio en tiempo real de criptomonedas o el P2P de Binance.
*   **`s.brecha`**
    Calcula la diferencia cambiaria (brecha) en bolívares entre la tasa oficial del BCV y el promedio del mercado de Binance P2P.
*   **`s.ping`**
    Muestra la latencia actual del bot.
*   **`s.roll [rango]`**
    Lanza un dado para obtener un número aleatorio (ej: `s.roll 1-100`).
*   **`s.tag [nombre]`**
    Permite guardar y reproducir textos o links personalizados (tags) en el servidor.
*   **`s.say [texto]`**
    Hace que el bot repita el mensaje indicado.

### 🛡️ Moderación

*   **`s.giveaway` o `s.sorteo`**
    Comando para gestionar sorteos en el servidor. Soporta subcomandos y un panel interactivo con botones y Modals para confirmar, cancelar o editar parámetros antes de iniciar.
    *   **Subcomandos:**
        *   `crear <#canal> <ganadores> <tiempo> <premio>`: Inicia el proceso de creación interactiva.
        *   `terminar <mensaje_id|enlace>`: Termina inmediatamente un sorteo activo y selecciona los ganadores.
        *   `reroll <mensaje_id|enlace>`: Vuelve a seleccionar ganadores de un sorteo ya finalizado a partir de las reacciones 🎉 existentes.
*   **`s.cumple`**
    Sistema interactivo de cumpleaños para el servidor. Permite registrar fechas, ver listas, el próximo cumpleaños, y configurar anuncios automáticos.
    *   *Uso común:*
        *   `s.cumple [DD/MM]`: Registra tu cumpleaños.
        *   `s.cumple lista`: Lista los cumpleaños del servidor agrupados por mes.
        *   `s.cumple proximo` / `anterior`: Muestra el cumpleaños más cercano en el futuro o pasado.
        *   `s.cumple canal #canal`: (Admin) Configura el canal de felicitaciones diarias.
        *   `s.cumple actualizar`: (Admin) Fuerza la comprobación y anuncio de cumpleaños del día.
*   **`s.rol`**
    Comando administrativo para la gestión rápida de roles del servidor.
    *   *Uso común:*
        *   `s.rol color <rol_id> <hex>`: Cambia el color de un rol específico.
        *   `s.rol otorgar <rol_id> <user_id>`: Otorga o remueve el rol a un usuario.
        *   `s.rol otorgarTodos <rol_id> [otorgar|remover|ambos]`: Otorga o remueve el rol a todos los miembros.
*   **`s.star`**
    Configura y procesa manualmente la función de *Starboard* (mensaje más votado del día anterior) para otorgar experiencia de Tatsu.
    *   *Uso común:*
        *   `s.star`: Procesa el mensaje destacado del día de ayer.
        *   `s.star config setFromChannel <canal_id>`: Establece el canal de origen de las imágenes.
        *   `s.star config setStarChannel <canal_id>`: Establece el canal del Starboard.
        *   `s.star config setLogsChannel <canal_id>`: Establece el canal para logs de experiencia.

### 🌸 Memes y Diversión

*   **`s.fumo`**
    Muestra una foto y detalles aleatorios de un Fumo de Touhou.
*   **`s.yuri`**
    Muestra una imagen de temática Yuri sincronizada de forma dinámica.
*   **`s.globo [usuario]`**
    Meme del globo de texto para responderle a alguien de forma divertida.
*   **`s.jeiden` / `s.femboy` / `s.oye` / `s.sex`**
    Diversos comandos cortos con chistes internos y reacciones de la comunidad.

### ℹ️ Información General

*   **`s.help` o `s.h`**
    Despliega el menú de ayuda interactivo.
*   **`s.acerca` o `s.about`**
    Muestra una presentación interactiva del bot Sengo y sus características.
*   **`s.contribuidores` o `s.con`**
    Lista los desarrolladores y usuarios vinculados a la comunidad por oAuth, agrupados por país y mostrando su estado de osu! supporter.
*   **`s.donadores`**
    Lista a los usuarios que apoyan económicamente el desarrollo de Sengo.
