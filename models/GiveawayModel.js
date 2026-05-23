const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function drawProvablyFair(serverSeed, participants, winnersCount) {
    const pool = [...participants].sort(); // Orden alfabético determinista de los IDs
    const winners = [];
    let round = 0;

    while (winners.length < winnersCount && pool.length > 0) {
        const hash = crypto.createHmac('sha256', serverSeed)
            .update(`${pool.join(',')}:${round}`)
            .digest('hex');

        // Tomar primeros 8 caracteres hexadecimales y convertirlos a entero
        const hexVal = hash.substring(0, 8);
        const intVal = parseInt(hexVal, 16);
        const winnerIndex = intVal % pool.length;

        winners.push(pool.splice(winnerIndex, 1)[0]);
        round++;
    }

    return winners;
}

async function filterParticipants(guild, participants, gw) {
    const filtered = [];
    const exclusions = [];
    for (const userId of participants) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            exclusions.push({ userId, reason: "No se encuentra en el servidor" });
            continue;
        }

        if (gw.requiredRoleId) {
            const hasRole = member.roles.cache.has(gw.requiredRoleId);
            if (!hasRole) {
                if (gw.allowHigherRoles) {
                    const reqRole = guild.roles.cache.get(gw.requiredRoleId);
                    const hasHigher = reqRole ? member.roles.cache.some(r => r.position >= reqRole.position) : false;
                    if (!hasHigher) {
                        exclusions.push({ userId, reason: "No posee el rol requerido ni uno superior" });
                        continue;
                    }
                } else {
                    exclusions.push({ userId, reason: "No posee el rol requerido" });
                    continue;
                }
            }
        }

        if (gw.blockOsuSupporters) {
            const OsuUserModel = require('./OsuUserModel.js');
            const linked = await OsuUserModel.getLinkedUser(null, userId);
            const oauthRecord = await OsuUserModel.getOAuthTokenRecord(userId);
            const osuId = linked?.osu_id || oauthRecord?.osu_id;

            if (!osuId) {
                exclusions.push({ userId, reason: "No está vinculado a SengoBot" });
                continue;
            }

            const profile = await OsuUserModel.getOsuUser({ username: [osuId], server: 'bancho' }).catch(() => null);
            if (!profile || profile === "El usuario no se encuentra en osu!") {
                exclusions.push({ userId, reason: "No se pudo validar su cuenta de osu!" });
                continue;
            }
            if (profile.is_supporter) {
                exclusions.push({ userId, reason: "Ya posee osu! supporter activo" });
                continue;
            }
        }

        filtered.push(userId);
    }
    return { filtered, exclusions };
}

const filePath = process.env.NODE_ENV === 'test'
    ? path.join(process.cwd(), 'db/local/giveaways_test.json')
    : path.join(process.cwd(), 'db/local/giveaways.json');

// Caché en memoria
let giveaways = [];
const activeTimeouts = new Map();

function loadGiveaways() {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf-8');
            giveaways = JSON.parse(data);
        } else {
            giveaways = [];
            fs.writeFileSync(filePath, JSON.stringify(giveaways, null, 4));
        }
    } catch (error) {
        console.error('Error al cargar sorteos:', error);
        giveaways = [];
    }
}

function saveGiveaways() {
    try {
        fs.writeFileSync(filePath, JSON.stringify(giveaways, null, 4));
    } catch (error) {
        console.error('Error al guardar sorteos:', error);
    }
}

/**
 * Inicializa y reanuda sorteos pendientes tras el reinicio del bot.
 */
function initGiveawayManager(client) {
    loadGiveaways();
    const now = Date.now();
    for (const gw of giveaways) {
        if (!gw.ended) {
            const timeLeft = gw.endAt - now;
            if (timeLeft <= 0) {
                endGiveaway(client, gw.messageId, true).catch(err => {
                    console.error(`Error al terminar sorteo vencido al arrancar: ${err.message}`);
                });
            } else {
                const timeout = setTimeout(() => {
                    endGiveaway(client, gw.messageId).catch(err => {
                        console.error(`Error al terminar sorteo programado: ${err.message}`);
                    });
                }, timeLeft);
                activeTimeouts.set(gw.messageId, timeout);
            }
        }
    }
}

/**
 * Registra un nuevo sorteo.
 */
function createGiveaway(client, { guildId, channelId, messageId, prize, winnersCount, durationMs, creatorId, serverSeed, serverSeedHash, requiredRoleId, allowHigherRoles, blockOsuSupporters }) {
    const finalServerSeed = serverSeed || crypto.randomBytes(16).toString('hex');
    const finalServerSeedHash = serverSeedHash || crypto.createHash('sha256').update(finalServerSeed).digest('hex');

    const endAt = Date.now() + durationMs;
    const newGw = {
        guildId,
        channelId,
        messageId,
        prize,
        winnersCount,
        endAt,
        ended: false,
        winners: [],
        creatorId,
        serverSeed: finalServerSeed,
        serverSeedHash: finalServerSeedHash,
        requiredRoleId: requiredRoleId || null,
        allowHigherRoles: !!allowHigherRoles,
        blockOsuSupporters: !!blockOsuSupporters,
        exclusions: []
    };
    giveaways.push(newGw);
    saveGiveaways();

    const timeout = setTimeout(() => {
        endGiveaway(client, messageId).catch(err => {
            console.error(`Error al terminar sorteo programado: ${err.message}`);
        });
    }, durationMs);
    activeTimeouts.set(messageId, timeout);
}

/**
 * Finaliza un sorteo activo inmediatamente y elige ganadores.
 */
async function endGiveaway(client, messageId, wasOffline = false) {
    const gw = giveaways.find(g => g.messageId === messageId);
    if (!gw) return null;
    if (gw.ended) return gw;

    if (activeTimeouts.has(messageId)) {
        clearTimeout(activeTimeouts.get(messageId));
        activeTimeouts.delete(messageId);
    }

    gw.ended = true;
    saveGiveaways();

    try {
        const channel = await client.channels.fetch(gw.channelId).catch(() => null);
        if (!channel) return gw;
        const msg = await channel.messages.fetch(gw.messageId).catch(() => null);
        if (!msg) return gw;

        // Limpiar botones si quedaran
        await msg.edit({ components: [] }).catch(() => {});

        const winners = [];
        if (!wasOffline) {
            const reaction = msg.reactions.cache.get('🎉');
            let participants = [];
            if (reaction) {
                const users = await reaction.users.fetch({ limit: 100 }).catch(() => new Map());
                participants = Array.from(users.values())
                    .filter(u => !u.bot)
                    .map(u => u.id);
            }

            if (participants.length > 0) {
                const { filtered, exclusions } = await filterParticipants(channel.guild, participants, gw);
                gw.exclusions = exclusions;
                if (filtered.length > 0) {
                    if (gw.serverSeed) {
                        winners.push(...drawProvablyFair(gw.serverSeed, filtered, gw.winnersCount));
                    } else {
                        const pool = [...filtered];
                        const countToPick = Math.min(gw.winnersCount, pool.length);
                        for (let i = 0; i < countToPick; i++) {
                            const idx = Math.floor(Math.random() * pool.length);
                            winners.push(pool.splice(idx, 1)[0]);
                        }
                    }
                }
            } else {
                gw.exclusions = [];
            }
        }

        gw.winners = winners;
        saveGiveaways();

        const { getGiveawayEndedEmbed } = require('../views/giveawayViews.js');
        const endedEmbed = getGiveawayEndedEmbed(gw, winners, null, wasOffline);
        await msg.edit({ embeds: [endedEmbed], components: [] }).catch(() => {});

        if (wasOffline) {
            const offlineText = `⚠️ El sorteo por **${gw.prize}** finalizó mientras el bot estaba desconectado. <@${gw.creatorId || ''}> ha sido notificado para decidir si realizar un re-roll o iniciar un sorteo nuevo.`;
            await channel.send({ content: offlineText, reply: { messageReference: msg.id } }).catch(() => {
                channel.send(offlineText).catch(() => {});
            });
        } else {
            const { getGiveawayEndedText } = require('../views/giveawayViews.js');
            const winText = getGiveawayEndedText(gw, winners);
            await channel.send({ content: winText, reply: { messageReference: msg.id } }).catch(() => {
                channel.send(winText).catch(() => {});
            });
        }

        // Enviar DM al creador avisándole del sorteo vencido offline
        if (wasOffline && gw.creatorId) {
            const creator = await client.users.fetch(gw.creatorId).catch(() => null);
            if (creator) {
                const prefix = client.config?.BOT_PREFIX || "s.";
                const dmMessage = `⚠️ **Notificación de Sorteo**: Tu sorteo por **${gw.prize}** (ID: \`${gw.messageId}\`) finalizó mientras yo estaba desconectado.\n` +
                    `No he seleccionado ganadores de forma automática. Si deseas elegir los ganadores a partir de los participantes registrados o iniciar uno nuevo, puedes hacerlo con:\n` +
                    `- Para realizar re-roll (elegir ganadores): \`${prefix}sorteo reroll ${gw.messageId}\`\n` +
                    `- Para crear uno nuevo: \`${prefix}sorteo crear\``;
                await creator.send(dmMessage).catch(() => {});
            }
        }

        return gw;
    } catch (error) {
        console.error(`Error al finalizar sorteo ${messageId}:`, error);
        return gw;
    }
}

/**
 * Vuelve a seleccionar ganadores de un sorteo ya finalizado.
 */
async function rerollGiveaway(client, messageId) {
    const gw = giveaways.find(g => g.messageId === messageId);
    if (!gw) return { error: "No se encontró ningún sorteo registrado con esa ID de mensaje." };
    if (!gw.ended) return { error: "El sorteo aún está en curso. Usa el subcomando `terminar` primero." };

    try {
        const channel = await client.channels.fetch(gw.channelId).catch(() => null);
        if (!channel) return { error: "No se pudo encontrar el canal del sorteo." };
        const msg = await channel.messages.fetch(gw.messageId).catch(() => null);
        if (!msg) return { error: "No se pudo encontrar el mensaje original del sorteo." };

        const reaction = msg.reactions.cache.get('🎉');
        let participants = [];
        if (reaction) {
            const users = await reaction.users.fetch({ limit: 100 }).catch(() => new Map());
            participants = Array.from(users.values())
                .filter(u => !u.bot)
                .map(u => u.id);
        }

        if (participants.length === 0) {
            return { error: "No hay participantes suficientes que hayan reaccionado con 🎉 para realizar el re-roll." };
        }

        const { filtered, exclusions } = await filterParticipants(channel.guild, participants, gw);
        gw.exclusions = exclusions;
        if (filtered.length === 0) {
            saveGiveaways();
            return { error: "Ningún participante que reaccionó cumple con los requisitos del sorteo (rol o no poseer supporter de osu!)." };
        }

        // Generar una nueva semilla para el re-roll para asegurar transparencia fresquita
        const newServerSeed = crypto.randomBytes(16).toString('hex');
        const newServerSeedHash = crypto.createHash('sha256').update(newServerSeed).digest('hex');
        gw.serverSeed = newServerSeed;
        gw.serverSeedHash = newServerSeedHash;

        const winners = drawProvablyFair(gw.serverSeed, filtered, gw.winnersCount);
        gw.winners = winners;
        saveGiveaways();

        const { getGiveawayEndedEmbed, getGiveawayRerollText } = require('../views/giveawayViews.js');
        const endedEmbed = getGiveawayEndedEmbed(gw, winners);
        await msg.edit({ embeds: [endedEmbed] }).catch(() => {});

        const rerollText = getGiveawayRerollText(gw, winners);
        await channel.send({ content: rerollText, reply: { messageReference: msg.id } }).catch(() => {
            channel.send(rerollText).catch(() => {});
        });

        return { success: true, winners };
    } catch (error) {
        console.error(`Error al realizar reroll del sorteo ${messageId}:`, error);
        return { error: `Error al realizar re-roll: ${error.message}` };
    }
}

/**
 * Obtiene la lista completa de sorteos (para depuración o uso futuro).
 */
function getGiveaways() {
    return giveaways;
}

module.exports = {
    initGiveawayManager,
    createGiveaway,
    endGiveaway,
    rerollGiveaway,
    getGiveaways
};
