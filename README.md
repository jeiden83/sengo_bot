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
