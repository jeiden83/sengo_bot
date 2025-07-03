const CONFIG = require("../../../config.json");
const { Tatsu } = require('tatsu');
const { EmbedBuilder } = require("discord.js");

const fs = require('fs');
const path = require('path');

const starboardConfigs_path = "../../../db/local/starboard.json";
const starboard_configs = require(starboardConfigs_path);

async function aumentarScore(guildId, userId, amount, result){
  const client = new Tatsu(CONFIG.TATSU_API_KEY);

  try {

    const res = await client.addGuildMemberScore(guildId, userId, amount);
    return `Por lo del **'starboard'**; La puntuacion de **\'${result.user.username}\'**, ha cambiado a **${res.score}**`;

  } catch (err) {

    console.error(err);
    return `No se pudo obtener la info info de Tatsu.`;
  }
}

async function countUniqueReactions(message) {
  const reactionFetches = message.reactions.cache.map(r => r.users.fetch());
  const usersLists = await Promise.all(reactionFetches);

  const unique = new Set();
  usersLists.forEach(list => list.forEach(u => {
    if (!u.bot) unique.add(u.id);
  }));

  return unique.size;
}

async function dailyTopFromChannel(message, channelId) {
  const channel = await message.client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error('Canal inválido');

  // Fecha de inicio del día anterior
  const since = new Date();
  since.setDate(since.getDate() - 1);
  since.setHours(0, 0, 0, 0);

  // Fecha de inicio del día actual (límite superior)
  const until = new Date();
  until.setHours(0, 0, 0, 0);

  const msgs = await channel.messages.fetch({ limit: starboard_configs[message.guild.id].msj_limit });

  const yesterdayMsgs = msgs.filter(m => m.createdAt >= since && m.createdAt < until);
  // const yesterdayMsgs = msgs.filter(m => m.createdAt >= until);

  const mediaMsgs = yesterdayMsgs.filter(m => {
    const hasEmbed = m.embeds.some(e => e.image);
    const hasAtt = m.attachments.some(a => a.contentType?.startsWith('image/'));
    const hasLink = /\bhttps?:\/\//.test(m.content);
    return hasEmbed || hasAtt || hasLink;
  });

  const scored = await Promise.all(mediaMsgs.map(async m => {

    const fullMsg = await m.fetch();
    // const fullMsg = m;
    
    const score = await countUniqueReactions(fullMsg);
    return { msg: fullMsg, score };
  }));

  if (scored.length === 0) return null;

  const top = scored.reduce((a, b) => a.score > b.score ? a : b);

  return {
    user: top.msg.author,
    message: top.msg,
    reactions: top.score
  };
}

async function doSetConfig(message, mode, variable){
  const guildId = message.guild.id;
  let msj = "Aqui no debe haber nada je.";

  // Inicializar el guild por si no esta en la db
  if(!starboard_configs[guildId]) starboard_configs[guildId] = {};

  if(mode == "fromChannel"){

    // Si existe channelId significa que se va a remplazar con uno, sea agregar o cambiar
    starboard_configs[message.guild.id].from_channel = `${variable}` || null;
    msj = `**Se** ha actualizado el canal de **entrada** del server.`
  
  } else if(mode == "starChannel"){

    starboard_configs[message.guild.id].star_channel = `${variable}` || null;
    msj = `**Se** ha actualizado el canal de **starboard** del server.`;
  
  } else if(mode == "msjLimit"){

    starboard_configs[message.guild.id].msj_limit = variable || null;
    msj = `**Se** ha actualizado la cantidad de mensajes a obtener.`;
    
  } else if(mode == "expValue"){

    starboard_configs[message.guild.id].exp_value = variable || null;
    msj = `**Se** ha actualizado el exp obtenido por mensaje.`;
  
  } else if(mode == "logsChannel"){

    starboard_configs[message.guild.id].logs_channel = variable || null;
    msj = `**Se** ha actualizado el canal de logs.`;
  }  

  fs.writeFileSync(path.join(__dirname, starboardConfigs_path), JSON.stringify(starboard_configs, null, 2));
  return msj + ` **Ahora es:** \`${variable}\``;
}

async function doConfigEmbed(message){
  const guildId = message.guild.id;

  const entradaField = starboard_configs[guildId]?.from_channel ? `\`${starboard_configs[guildId].from_channel}\` : <#${starboard_configs[guildId].from_channel}>` : "**No** se ha configurado el canal de entrada"
  const starField = starboard_configs[guildId]?.star_channel ? `\`${starboard_configs[guildId].star_channel}\` : <#${starboard_configs[guildId].star_channel}>` : "**No** se ha configurado el canal 'starboard'"
  const logsField = starboard_configs[guildId]?.logs_channel ? `\`${starboard_configs[guildId].logs_channel}\` : <#${starboard_configs[guildId].logs_channel}>` : "**No** se ha configurado el canal de logs"


  const embed = new EmbedBuilder()
  .setAuthor({
    name: `Configs del 'starboard' de ${message.guild.name}`,
    iconURL: message.guild.iconURL({ dynamic: true, size: 1024 })
  })
  .addFields(
    {
        name: "Canal de entrada",
        value: entradaField,
        inline: false
    },
    {
      name: "Canal de 'starboard'",
      value: starField,
      inline: false
    },
    {
      name: "Canal de logs",
      value: logsField,
      inline: false
    },
    {
      name: "Limite de mensajes",
      value: `**\`${starboard_configs[guildId]?.msj_limit || "Pero si no lo has configurado"}\`**`,
      inline: false
    },
    {
      name: "Exp por msj",
      value: `**\`${starboard_configs[guildId]?.exp_value || "Pero si no lo has configurado"}\`**`,
      inline: true
    })
  .setFooter({
      text: "SengoBot",
      iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
  })

  return { embeds: [embed] }
}

function doStaboardMsjEmbed(message, result){

  const embed = new EmbedBuilder()
  .setAuthor({
    name: `El mensaje del día de ayer con más reacciones únicas (${result.reactions}) es de: ${result.user.username}`,
    iconURL: message.guild.iconURL({ dynamic: true, size: 1024 }),
    url: result.message.url
  })
  .setColor(message.member.roles.highest.color || '#ffffff')
  .setFooter({
    text: `${result.user.username} procede a llevarse ${starboard_configs[message.guild.id].exp_value} exp`,
    iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
  })
  .setTimestamp(result.message.createdTimestamp)

  embed.setImage(
    result.message.attachments.first()?.url ||
    result.message.embeds[0]?.image?.url ||
    null
  );

  return { embeds: [embed] };
}

async function run(messages, args) {
  const { message, res } = messages;

  // Revisa si es admin O tiene el rol 'Sengo'
  const hasAdmin = message.member.permissions.has('Administrator');
  const hasSengoRole = message.member.roles.cache.some(role => role.name === 'Sengo');

  if (!hasAdmin && !hasSengoRole) {
    return '❌ No eres admin ni tienes el rol **Sengo**, no puedes usar este comando.';
  }

  // iniciar daily
  if(!args[0]){
    const guildId = message.guild.id

    // Primero a revisar el canal a buscar las imagenes
    if(!starboard_configs[guildId]?.from_channel || starboard_configs[guildId].from_channel == "null") return `No existe canal de donde se obtendran las fotos.`;

    // Luego a ver si el canal del starboard esta tambien
    if(!starboard_configs[guildId]?.star_channel || starboard_configs[guildId].star_channel == "null") return `No existe el canal 'starboard'.`;

    // Luego a ver si la cantidad de mensajes a obtener tambien esta configurado
    if(!starboard_configs[guildId]?.msj_limit || starboard_configs[guildId].msj_limit == "null") return `No se ha configurado cuantos mensajes se van a obtener del canal.`;

    // Luego a ver si la cantidad de exp por mensaje tambien esta configurado
    if(!starboard_configs[guildId]?.exp_value || starboard_configs[guildId].exp_value == "null") return `No se ha configurado cuanto exp vale cada mensaje del 'starboard'.`;

    // Revisar si ya hubo un msj star en este mismo dia
    const starChannel = await message.client.channels.fetch(starboard_configs[guildId].star_channel);
    const today = new Date();
          today.setHours(0, 0, 0, 0);
    const messagesToday = await starChannel.messages.fetch({ limit: 2 });
    const alreadySent = messagesToday.some(m => m.createdAt >= today);
    if (alreadySent){

      const msj =` > En la guild '${message.guild.name} : ${message.guild.id}', ya fue mandado el msj 'starboard' en el canal: ${starboard_configs[guildId].star_channel}`;
      console.log(new Date().toLocaleString() + msj);
      return msj;
    } 

    // Obtener los mensajes con imagenes
    const result = await dailyTopFromChannel(message, starboard_configs[guildId].from_channel);
    if (!result) return 'No se encontraron mensajes con media hoy.';
    
    // Se manda el embed del dia
    await starChannel.send(doStaboardMsjEmbed(message, result));
    
    // Asi como el log de los puntos obtenidos del autor ganador
    const logsChannel = await message.client.channels.fetch(starboard_configs[guildId].logs_channel);
    await logsChannel.send(await aumentarScore(guildId, result.user.id, parseInt(starboard_configs[guildId].exp_value), result));

    return ;

  } else if(args[0] == "config"){

    // Para colocar el canal de donde se obtendran las fotos
    if(args[1] == "setFromChannel"){

      return await doSetConfig(message, "fromChannel", args[2]);

       // Para colocar el canal de donde sera el starboard
    } else if(args[1] == "setStarChannel"){

      return await doSetConfig(message, "starChannel", args[2]);
    
      // Para colocar la cantidad de mensajes a obtener del canal de inicio
    } else if(args[1] == "setMsjLimit"){

      return await doSetConfig(message, "msjLimit", args[2]);

    // Para colocar el exp a dar con  el tatsumaki
    }else if(args[1] == "setExpReward"){

      return await doSetConfig(message, "expValue", args[2]);

    }else if(args[1] == "setLogsChannel"){

      return await doSetConfig(message, "logsChannel", args[2]);
    }  
  }

  return await doConfigEmbed(message);
}
run.description = {
  header: 'Funcion starboard',
  body: `Con la configuracion de un canal de entrada, de 'starboard', mensajes a obtener y a exp dar por tatsumaki, da exp al mensaje con mas reacciones unicas del dia pasado.`,
  usage: 'el diablo'
};

module.exports = { run }