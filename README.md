# Sengo bot

![](https://jeiden.s-ul.eu/9dtHHLhw)


Bot de de Discord para [**osu!**](https://osu.ppy.sh/) hecho para suplir algunas carencias de los actuales. Inspirado en el [**owo!**](https://github.com/AznStevy/owo-bot) 
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
```

- Correr el bot con el `run.sh` (recomendado), o bien con:
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
*   **`s.rs [usuario]` (Recent Score)**
    Muestra la jugada más reciente del usuario.
    *   *Parámetros útiles:*
        *   `-d` o `-detail`: Muestra detalles completos (aciertos, fallos, UR, etc.).
        *   `-l` o `-list`: Muestra una lista de las últimas 5 jugadas del usuario.
        *   `-b` o `-pp`: Ordena las jugadas recientes por cantidad de PP en lugar de fecha.
*   **`s.top [usuario]`**
    Muestra los mejores registros (Top Plays) del usuario.
*   **`s.c` o `s.compare`**
    Compara las puntuaciones locales del usuario en el último mapa mostrado en el canal de Discord.
*   **`s.subir`**
    Sube y calcula los datos detallados de una jugada.
*   **`s.lb` o `s.leaderboard`**
    Muestra la tabla de clasificación general.
    *   *Parámetro útil:* `-pais [código/nombre]` (ej: `-pais VE` para mostrar solo Venezuela).
*   **`s.pais [código/nombre]`**
    Muestra el ranking local del país especificado.
*   **`s.gap [jugador1] [jugador2]`**
    Muestra la brecha (gap) en rango y PP entre dos jugadores.
*   **`s.amigos`**
    Compara y muestra el ranking entre tus amigos mutuals agregados al bot.
*   **`s.link [-oauth]`**
    Vincula tu cuenta de osu! a tu Discord. El uso de `-oauth` te enviará un mensaje privado con un enlace web seguro de autorización oficial.
*   **`s.bg`**
    Muestra la imagen de fondo (background) del último mapa enviado en el chat.
*   **`s.replay`**
    Analiza un archivo `.osr` adjunto de replay y muestra sus estadísticas.
*   **`s.digitos`**
    Muestra cuántos dígitos tiene el rango de los usuarios.

### 🛠️ Utilidades

*   **`s.bcv [moneda]`**
    Muestra la tasa oficial de cambio del Banco Central de Venezuela (soporta dolar, euro, yuan, etc.).
*   **`s.binance [par]`**
    Muestra el precio en tiempo real de criptomonedas o el P2P de Binance.
*   **`s.ping`**
    Muestra la latencia actual del bot.
*   **`s.roll [rango]`**
    Lanza un dado para obtener un número aleatorio (ej: `s.roll 1-100`).
*   **`s.tag [nombre]`**
    Permite guardar y reproducir textos o links personalizados (tags) en el servidor.
*   **`s.say [texto]`**
    Hace que el bot repita el mensaje indicado.

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
*   **`s.contribuidores` o `s.con`**
    Lista los desarrolladores y usuarios vinculados a la comunidad por oAuth, agrupados por país y mostrando su estado de osu! supporter.

