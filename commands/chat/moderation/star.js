const CONFIG = require("../../../config.json");
const { Tatsu } = require('tatsu');
const { EmbedBuilder } = require("discord.js");

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

async function dailyTopFromChannel(message, channelId, config) {
  const channel = await message.client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error('Canal inválido');

  const since = new Date();
  since.setDate(since.getDate() - 1);
  since.setHours(0, 0, 0, 0);

  const until = new Date();
  until.setHours(0, 0, 0, 0);

  const msgs = await channel.messages.fetch({ limit: config?.msj_limit || 100 });

  // Filtrar mensajes del rango de ayer y que NO sean de bots
  const yesterdayMsgs = msgs.filter(m => 
    m.createdAt >= since && m.createdAt < until && !m.author.bot
  );

  const mediaMsgs = yesterdayMsgs.filter(m => {
    const hasEmbed = m.embeds.some(e => e.image);
    const hasAtt = m.attachments.some(a => a.contentType?.startsWith('image/'));
    const hasLink = /\bhttps?:\/\//.test(m.content);
    return hasEmbed || hasAtt || hasLink;
  });

  const scored = await Promise.all(mediaMsgs.map(async m => {

    const fullMsg = await m.fetch();
    
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
  const { getSupabaseClient } = require("../../../db/database.js");
  const supabase = getSupabaseClient();
  if (!supabase) return "⚠️ Supabase no está conectado.";

  let msj = "Aqui no debe haber nada je.";

  const columnMap = {
    fromChannel: 'from_channel',
    starChannel: 'star_channel',
    msjLimit: 'msj_limit',
    expValue: 'exp_value',
    logsChannel: 'logs_channel'
  };

  const columnName = columnMap[mode];
  if (!columnName) return "Modo no soportado.";

  let dbValue = variable;
  if (columnName === 'msj_limit' || columnName === 'exp_value') {
    dbValue = variable ? parseInt(variable) : null;
  }

  if (mode === "fromChannel") {
    msj = `**Se** ha actualizado el canal de **entrada** del server.`;
  } else if (mode === "starChannel") {
    msj = `**Se** ha actualizado el canal de **starboard** del server.`;
  } else if (mode === "msjLimit") {
    msj = `**Se** ha actualizado la cantidad de mensajes a obtener.`;
  } else if (mode === "expValue") {
    msj = `**Se** ha actualizado el exp obtenido por mensaje.`;
  } else if (mode === "logsChannel") {
    msj = `**Se** ha actualizado el canal de logs.`;
  }

  const { error } = await supabase
    .from('starboard_configs')
    .upsert({
      guild_id: guildId,
      [columnName]: dbValue
    }, { onConflict: 'guild_id' });

  if (error) {
    console.error('Error actualizando config en Supabase:', error);
    return `❌ Error al actualizar config en la base de datos: ${error.message}`;
  }

  return msj + ` **Ahora es:** \`${variable}\``;
}

async function doConfigEmbed(message, config){
  const entradaField = config?.from_channel ? `\`${config.from_channel}\` : <#${config.from_channel}>` : "**No** se ha configurado el canal de entrada"
  const starField = config?.star_channel ? `\`${config.star_channel}\` : <#${config.star_channel}>` : "**No** se ha configurado el canal 'starboard'"
  const logsField = config?.logs_channel ? `\`${config.logs_channel}\` : <#${config.logs_channel}>` : "**No** se ha configurado el canal de logs"

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
      value: `**\`${config?.msj_limit || "Pero si no lo has configurado"}\`**`,
      inline: false
    },
    {
      name: "Exp por msj",
      value: `**\`${config?.exp_value || "Pero si no lo has configurado"}\`**`,
      inline: true
    })
  .setFooter({
      text: "SengoBot",
      iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
  })

  return { embeds: [embed] }
}

function doStaboardMsjEmbed(message, result, config){

  const embed = new EmbedBuilder()
  .setAuthor({
    name: `El mensaje del día de ayer con más reacciones únicas (${result.reactions}) es de: ${result.user.username}`,
    iconURL: message.guild.iconURL({ dynamic: true, size: 1024 }),
    url: result.message.url
  })
  .setColor(message.member.roles.highest.color || '#ffffff')
  .setFooter({
    text: `${result.user.username} procede a llevarse ${config?.exp_value || 0} exp`,
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

  if (!message.guild) {
    return "Este comando solo se puede usar en un servidor.";
  }

  // Revisa si es admin O tiene el rol 'Sengo'
  const hasAdmin = message.member.permissions.has('Administrator');
  const hasSengoRole = message.member.roles.cache.some(role => role.name === 'Sengo');

  if (!hasAdmin && !hasSengoRole) {
    return '❌ No eres admin ni tienes el rol **Sengo**, no puedes usar este comando.';
  }

  const guildId = message.guild.id;
  const { getSupabaseClient } = require("../../../db/database.js");
  const supabase = getSupabaseClient();
  if (!supabase) return "⚠️ Supabase no está conectado.";

  // Fetch current config
  const { data: config, error: fetchError } = await supabase
    .from('starboard_configs')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();

  if (fetchError) {
    console.error('Error al obtener config de starboard:', fetchError);
    return `❌ Error al obtener la configuración de la base de datos: ${fetchError.message}`;
  }

  // iniciar daily
  if(!args[0]){
    // Primero a revisar el canal a buscar las imagenes
    if(!config?.from_channel || config.from_channel == "null") return `No existe canal de donde se obtendran las fotos.`;

    // Luego a ver si el canal del starboard esta tambien
    if(!config?.star_channel || config.star_channel == "null") return `No existe el canal 'starboard'.`;

    // Luego a ver si la cantidad de mensajes a obtener tambien esta configurado
    if(!config?.msj_limit || config.msj_limit == "null") return `No se ha configurado cuantos mensajes se van a obtener del canal.`;

    // Luego a ver si la cantidad de exp por mensaje tambien esta configurado
    if(!config?.exp_value || config.exp_value == "null") return `No se ha configurado cuanto exp vale cada mensaje del 'starboard'.`;

    // Revisar si ya hubo un msj star en este mismo dia
    const starChannel = await message.client.channels.fetch(config.star_channel);
    const today = new Date();
          today.setHours(0, 0, 0, 0);
    const messagesToday = await starChannel.messages.fetch({ limit: 2 });
    const alreadySent = messagesToday.some(m => m.createdAt >= today);
    if (alreadySent && config.star_channel != config.from_channel){

      const msj =` > En la guild '${message.guild.name} : ${message.guild.id}', ya fue mandado el msj 'starboard' en el canal: ${config.star_channel}`;
      console.log(new Date().toLocaleString() + msj);
      return msj;
    } 

    // Obtener los mensajes con imagenes
    const result = await dailyTopFromChannel(message, config.from_channel, config);
    if (!result) return 'No se encontraron mensajes con media hoy.';
    
    // Se manda el embed del dia
    await starChannel.send(doStaboardMsjEmbed(message, result, config));
    
    // Asi como el log de los puntos obtenidos del autor ganador
    const logsChannel = await message.client.channels.fetch(config.logs_channel);
    await logsChannel.send(await aumentarScore(guildId, result.user.id, parseInt(config.exp_value), result));

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

  return await doConfigEmbed(message, config);
}
run.description = {
  header: 'Funcion starboard',
  body: `Con la configuracion de un canal de entrada, de 'starboard', mensajes a obtener y a exp dar por tatsumaki, da exp al mensaje con mas reacciones unicas del dia pasado.`,
  usage: 'el diablo'
};

module.exports = { run }