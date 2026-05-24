const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'db/local/birthdays.json');

// Caché en memoria
let db = {
    configs: {},
    users: {}
};

/**
 * Carga los datos de cumpleaños desde el archivo local JSON.
 */
function loadBirthdays() {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf-8');
            db = JSON.parse(data);
            if (!db.configs) db.configs = {};
            if (!db.users) db.users = {};
        } else {
            db = { configs: {}, users: {} };
            fs.writeFileSync(filePath, JSON.stringify(db, null, 4));
        }
    } catch (error) {
        console.error('Error al cargar cumpleaños:', error);
        db = { configs: {}, users: {} };
    }
}

/**
 * Guarda los datos de cumpleaños en el archivo local JSON.
 */
function saveBirthdays() {
    try {
        fs.writeFileSync(filePath, JSON.stringify(db, null, 4));
    } catch (error) {
        console.error('Error al guardar cumpleaños:', error);
    }
}

// Carga inicial de datos
loadBirthdays();

/**
 * Guarda o edita el cumpleaños de un usuario.
 * @param {string} userId - ID del usuario de Discord.
 * @param {number} day - Día del mes.
 * @param {number} month - Mes (1-12).
 * @param {number|null} year - Año de nacimiento opcional.
 */
function setUserBirthday(userId, day, month, year = null) {
    db.users[userId] = { day, month, year };
    saveBirthdays();
}

/**
 * Obtiene el cumpleaños de un usuario.
 * @param {string} userId - ID del usuario de Discord.
 * @returns {Object|null} Objeto con { day, month, year } o null.
 */
function getUserBirthday(userId) {
    return db.users[userId] || null;
}

/**
 * Elimina el cumpleaños de un usuario.
 * @param {string} userId - ID del usuario de Discord.
 * @returns {boolean} True si fue eliminado, False en caso contrario.
 */
function removeUserBirthday(userId) {
    if (db.users[userId]) {
        delete db.users[userId];
        saveBirthdays();
        return true;
    }
    return false;
}

/**
 * Configura el canal de anuncios de cumpleaños de un servidor.
 * @param {string} guildId - ID del servidor.
 * @param {string|null} channelId - ID del canal o null para desactivar.
 */
function setGuildChannel(guildId, channelId) {
    if (!db.configs[guildId]) {
        db.configs[guildId] = {};
    }
    db.configs[guildId].channelId = channelId;
    saveBirthdays();
}

/**
 * Obtiene el canal de anuncios de cumpleaños de un servidor.
 * @param {string} guildId - ID del servidor.
 * @returns {string|null} ID del canal o null si no está configurado.
 */
function getGuildChannel(guildId) {
    return db.configs[guildId]?.channelId || null;
}

/**
 * Obtiene la fecha del último anuncio realizado en el servidor.
 * @param {string} guildId - ID del servidor.
 * @returns {string|null} Fecha en formato YYYY-MM-DD o null.
 */
function getGuildLastAnnounced(guildId) {
    return db.configs[guildId]?.lastAnnouncedDate || null;
}

/**
 * Guarda la fecha del último anuncio realizado en el servidor.
 * @param {string} guildId - ID del servidor.
 * @param {string} dateStr - Fecha en formato YYYY-MM-DD.
 */
function setGuildLastAnnounced(guildId, dateStr) {
    if (!db.configs[guildId]) {
        db.configs[guildId] = {};
    }
    db.configs[guildId].lastAnnouncedDate = dateStr;
    saveBirthdays();
}

/**
 * Obtiene la configuración del servidor.
 * @param {string} guildId - ID del servidor.
 * @returns {Object|null} Objeto de configuración o null.
 */
function getGuildConfig(guildId) {
    return db.configs[guildId] || null;
}

/**
 * Obtiene todos los cumpleaños registrados en el bot.
 * @returns {Object} Diccionario de usuarios con cumpleaños.
 */
function getAllUsers() {
    return db.users;
}

/**
 * Obtiene los cumpleaños que coinciden con el día y mes especificados.
 * @param {number} day - Día del mes.
 * @param {number} month - Mes (1-12).
 * @returns {Array} Lista de cumpleaños { userId, day, month, year }.
 */
function getBirthdaysToday(day, month) {
    const list = [];
    for (const [userId, info] of Object.entries(db.users)) {
        if (info.day === day && info.month === month) {
            list.push({ userId, ...info });
        }
    }
    return list;
}

/**
 * Obtiene los cumpleaños de todos los miembros del servidor especificado.
 * @param {Guild} guild - Instancia de Guild de Discord.js.
 * @returns {Promise<Array>} Lista de cumpleaños ordenada cronológicamente.
 */
async function getGuildBirthdays(guild) {
    const members = await guild.members.fetch().catch(() => guild.members.cache);
    if (!members) return [];

    const list = [];
    for (const [userId, info] of Object.entries(db.users)) {
        if (members.has(userId)) {
            list.push({ userId, ...info, member: members.get(userId) });
        }
    }

    // Ordenar de forma cronológica por mes, luego día
    list.sort((a, b) => {
        if (a.month !== b.month) return a.month - b.month;
        if (a.day !== b.day) return a.day - b.day;
        // Si coinciden en día/mes, ordenar por nombre/tag
        const nameA = a.member.user.username || '';
        const nameB = b.member.user.username || '';
        return nameA.localeCompare(nameB);
    });

    return list;
}

/**
 * Obtiene los próximos cumpleaños del servidor.
 * Devuelve el cumpleaños más cercano en el futuro y sus usuarios correspondientes.
 * @param {Guild} guild - Servidor.
 * @param {Date} today - Fecha base de comparación.
 */
async function getNextBirthdays(guild, today) {
    const list = await getGuildBirthdays(guild);
    if (list.length === 0) return null;

    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const mapped = list.map(item => {
        let occurrence = new Date(today.getFullYear(), item.month - 1, item.day);
        // Si ya pasó hoy, es el próximo año
        if (occurrence < todayMidnight) {
            occurrence.setFullYear(today.getFullYear() + 1);
        }
        const diffMs = occurrence.getTime() - todayMidnight.getTime();
        const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
        return { ...item, daysLeft: days, occurrence };
    });

    // Ordenar por días restantes ascendente
    mapped.sort((a, b) => a.daysLeft - b.daysLeft);

    const minDaysLeft = mapped[0].daysLeft;
    const closest = mapped.filter(item => item.daysLeft === minDaysLeft);

    return {
        daysLeft: minDaysLeft,
        birthdays: closest
    };
}

/**
 * Obtiene los cumpleaños anteriores más cercanos del servidor.
 * Devuelve el cumpleaños más cercano en el pasado y sus usuarios correspondientes.
 * @param {Guild} guild - Servidor.
 * @param {Date} today - Fecha base de comparación.
 */
async function getPrevBirthdays(guild, today) {
    const list = await getGuildBirthdays(guild);
    if (list.length === 0) return null;

    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const mapped = list.map(item => {
        let occurrence = new Date(today.getFullYear(), item.month - 1, item.day);
        // Si es posterior a hoy, fue el año pasado
        if (occurrence > todayMidnight) {
            occurrence.setFullYear(today.getFullYear() - 1);
        }
        const diffMs = todayMidnight.getTime() - occurrence.getTime();
        const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
        return { ...item, daysAgo: days, occurrence };
    });

    // Ordenar por días transcurridos ascendente
    mapped.sort((a, b) => a.daysAgo - b.daysAgo);

    const minDaysAgo = mapped[0].daysAgo;
    const closest = mapped.filter(item => item.daysAgo === minDaysAgo);

    return {
        daysAgo: minDaysAgo,
        birthdays: closest
    };
}

module.exports = {
    setUserBirthday,
    getUserBirthday,
    removeUserBirthday,
    setGuildChannel,
    getGuildChannel,
    getGuildLastAnnounced,
    setGuildLastAnnounced,
    getGuildConfig,
    getAllUsers,
    getBirthdaysToday,
    getGuildBirthdays,
    getNextBirthdays,
    getPrevBirthdays
};
