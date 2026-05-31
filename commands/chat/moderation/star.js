const CONFIG = require("../../../config.js");
const { Tatsu } = require('tatsu');
const { doStarboardConfigEmbed, doStarboardMsjEmbed } = require("../../../views/starboardViews.js");
const { t } = require("../../../utils/i18n.js");

async function aumentarScore(guildId, userId, amount, result, locale) {
  const client = new Tatsu(CONFIG.TATSU_API_KEY);

  try {
    const res = await client.addGuildMemberScore(guildId, userId, amount);
    return t(locale, 'starboard.score_changed', { username: result.user.username, score: res.score });
  } catch (err) {
    console.error(err);
    return t(locale, 'starboard.tatsu_error');
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

async function dailyTopFromChannel(message, channelId, config, locale) {
  const channel = await message.client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error(t(locale, 'starboard.invalid_channel'));

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

async function doSetConfig(message, mode, variable, locale) {
  const guildId = message.guild.id;
  const { getSupabaseClient } = require("../../../db/database.js");
  const supabase = getSupabaseClient();
  if (!supabase) return t(locale, 'starboard.supabase_disconnected');

  let msj = "Aqui no debe haber nada je.";

  const columnMap = {
    fromChannel: 'from_channel',
    starChannel: 'star_channel',
    msjLimit: 'msj_limit',
    expValue: 'exp_value',
    logsChannel: 'logs_channel'
  };

  const columnName = columnMap[mode];
  if (!columnName) return t(locale, 'starboard.mode_not_supported');

  let dbValue = variable;
  if (columnName === 'msj_limit' || columnName === 'exp_value') {
    dbValue = variable ? parseInt(variable) : null;
  }

  if (mode === "fromChannel") {
    msj = t(locale, 'starboard.updated_from_channel');
  } else if (mode === "starChannel") {
    msj = t(locale, 'starboard.updated_star_channel');
  } else if (mode === "msjLimit") {
    msj = t(locale, 'starboard.updated_msj_limit');
  } else if (mode === "expValue") {
    msj = t(locale, 'starboard.updated_exp_value');
  } else if (mode === "logsChannel") {
    msj = t(locale, 'starboard.updated_logs_channel');
  }

  const { error } = await supabase
    .from('starboard_configs')
    .upsert({
      guild_id: guildId,
      [columnName]: dbValue
    }, { onConflict: 'guild_id' });

  if (error) {
    console.error('Error actualizando config en Supabase:', error);
    return t(locale, 'starboard.db_update_error', { error: error.message });
  }

  return msj + t(locale, 'starboard.now_is', { value: variable });
}

async function run(messages, args) {
  const { message, res } = messages;
  const locale = message.locale || 'es';

  if (!message.guild) {
    return t(locale, 'starboard.only_guild');
  }

  // Revisa si es admin O tiene el rol 'Sengo'
  const hasAdmin = message.member.permissions.has('Administrator');
  const hasSengoRole = message.member.roles.cache.some(role => role.name === 'Sengo');

  if (!hasAdmin && !hasSengoRole) {
    return t(locale, 'starboard.no_permission');
  }

  const guildId = message.guild.id;
  const { getSupabaseClient } = require("../../../db/database.js");
  const supabase = getSupabaseClient();
  if (!supabase) return t(locale, 'starboard.supabase_disconnected');

  // Fetch current config
  const { data: config, error: fetchError } = await supabase
    .from('starboard_configs')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();

  if (fetchError) {
    console.error('Error al obtener config de starboard:', fetchError);
    return t(locale, 'starboard.db_fetch_error', { error: fetchError.message });
  }

  // Iniciar daily
  if (!args[0]) {
    // Primero a revisar el canal a buscar las imagenes
    if (!config?.from_channel || config.from_channel == "null") return t(locale, 'starboard.err_no_from_channel');

    // Luego a ver si el canal del starboard esta tambien
    if (!config?.star_channel || config.star_channel == "null") return t(locale, 'starboard.err_no_star_channel');

    // Luego a ver si la cantidad de mensajes a obtener tambien esta configurado
    if (!config?.msj_limit || config.msj_limit == "null") return t(locale, 'starboard.err_no_msj_limit');

    // Luego a ver si la cantidad de exp por mensaje tambien esta configurado
    if (!config?.exp_value || config.exp_value == "null") return t(locale, 'starboard.err_no_exp_value');

    // Revisar si ya hubo un msj star en este mismo dia
    const starChannel = await message.client.channels.fetch(config.star_channel);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const messagesToday = await starChannel.messages.fetch({ limit: 2 });
    const alreadySent = messagesToday.some(m => m.createdAt >= today);
    if (alreadySent && config.star_channel != config.from_channel) {
      const msj = t(locale, 'starboard.already_sent', { guildName: message.guild.name, guildId: message.guild.id, channelId: config.star_channel });
      console.log(new Date().toLocaleString() + msj);
      return msj;
    } 

    // Obtener los mensajes con imagenes
    const result = await dailyTopFromChannel(message, config.from_channel, config, locale);
    if (!result) return t(locale, 'starboard.no_messages_media');
    
    // Se manda el embed del dia
    const msjEmbed = doStarboardMsjEmbed({ message, result, config, locale });
    await starChannel.send({ embeds: [msjEmbed] });
    
    // Asi como el log de los puntos obtenidos del autor ganador
    const logsChannel = await message.client.channels.fetch(config.logs_channel);
    const pointsLog = await aumentarScore(guildId, result.user.id, parseInt(config.exp_value), result, locale);
    await logsChannel.send(pointsLog);

    return t(locale, 'starboard.success_processed');

  } else if (args[0] == "config") {
    if (args[1] == "setFromChannel") {
      return await doSetConfig(message, "fromChannel", args[2], locale);
    } else if (args[1] == "setStarChannel") {
      return await doSetConfig(message, "starChannel", args[2], locale);
    } else if (args[1] == "setMsjLimit") {
      return await doSetConfig(message, "msjLimit", args[2], locale);
    } else if (args[1] == "setExpReward") {
      return await doSetConfig(message, "expValue", args[2], locale);
    } else if (args[1] == "setLogsChannel") {
      return await doSetConfig(message, "logsChannel", args[2], locale);
    }  
  }

  const configEmbed = doStarboardConfigEmbed({ message, config, locale });
  return { embeds: [configEmbed] };
}

run.description = {
  header: 'Función starboard / Starboard function',
  body: 'Procesa y destaca el mensaje con más reacciones únicas del día anterior en el canal configurado, asignando experiencia. / Processes and highlights the message with the most unique reactions from the previous day in the configured channel, rewarding experience.',
  usage: 's.star'
};

module.exports = { run };