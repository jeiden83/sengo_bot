require('dotenv').config();

module.exports = {
    // Configuración de Discord
    TOKEN: process.env.DISCORD_TOKEN || process.env.TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    BOT_PREFIX: process.env.BOT_PREFIX || "s.",

    // Configuración de osu! API
    OSU_CLIENT_ID: process.env.OSU_CLIENT_ID ? parseInt(process.env.OSU_CLIENT_ID, 10) : undefined,
    OSU_CLIENT_SECRET: process.env.OSU_CLIENT_SECRET,

    // Configuración de Supabase
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_KEY: process.env.SUPABASE_KEY,

    // Configuración de Tatsu (opcional)
    TATSU_API_KEY: process.env.TATSU_API_KEY
};
