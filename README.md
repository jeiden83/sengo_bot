# Sengo bot

![](https://jeiden.s-ul.eu/9dtHHLhw)


Bot de de Discord para [**osu!**](https://osu.ppy.sh/) hecho para suplir algunas carencias de los actuales. Inspirado en el [**owo!**](https://github.com/AznStevy/owo-bot) 
> El servidor mencionado en algunos comandos es el [**Osu Latinoamerica!**](https://discord.gg/4GHYpRn) 

## Instalacion
- Crea una carpeta y clona el repositorio con:

```bash
git clone https://github.com/jeiden83/sengo_bot
``` 
- Instala las dependencias:
```bash
npm install discord.js mongodb osu-api-extended rosu-pp-js
```

- Renombra el **config.json** ~~.dummy~~, y sigue los pasos para rellenar el archivo de configuraciones:
```js
{
    // Se obtienen al crear una nueva OAuth Application
    // https://osu.ppy.sh/home/account/edit 
	"OSU_CLIENT_SECRET" : "Key del cliente secreto",
	"OSU_CLIENT_ID" : 0, // Id del cliente 

    // Aplicacion del lado de Discord
    // Se crea una nueva app de Discord y se rellena lo necesario
    // https://discord.com/developers/applications
	"TOKEN" : "Key del apartado Bot", // Bot -> Token
	"BOT_PREFIX" : "s.", // Prefijo del bot
	"CLIENT_ID" : "Numeros", // OAuth -> Client information
    // Client secret no necesario por ahora

    // Se obtiene al crear una nueva DB en MongoDB
    // Appname > Connect > Drivers > Conection string
    // uri de ejemplo, copiarla y dejarla en una sola linea
	"DB_URI": `mongodb+srv://${db_user}:${db_password}@${db_url}.net/?retryWrites=true&w=majority&appName=${app_name}`

    // Es para el comando 'starboard'
    // Asegurarse que tiene todos los permisos para dar puntos y eso
    "TATSU_API_KEY" : `KEY DE TATSUMAKI`
}
```

- Correr el bot con el `run.sh` (recomendado), o bien con:
```bash
node .
```
- Disfruta flexear al Sengo bot. 
- *(Opcional)* Avisarle a `jeiden83` de que has hecho todo hasta aqui.
