const CONFIG = require("../config.json");
const { createClient } = require('@supabase/supabase-js');

let supabase;

async function connectDB(config) {
    try {
        console.log("# Conectando a Supabase...");
        
        const url = config.SUPABASE_URL || CONFIG.SUPABASE_URL;
        const key = config.SUPABASE_KEY || CONFIG.SUPABASE_KEY;
        
        supabase = createClient(url, key);

        const User = {
            async findOne({ discord_id }) {
                const { data, error } = await supabase
                    .from('users')
                    .select('*')
                    .eq('discord_id', discord_id)
                    .maybeSingle();

                if (error) {
                    console.error('Error en User.findOne de Supabase:', error);
                    throw new Error(`Database error: ${error.message}`);
                }
                return data;
            },
            async find(query) {
                let q = supabase.from('users').select('*');
                
                if (query) {
                    if (query.osu_id && typeof query.osu_id === 'object') {
                        if (query.osu_id.$ne === null) {
                            q = q.not('osu_id', 'is', null);
                        } else {
                            q = q.neq('osu_id', query.osu_id.$ne);
                        }
                    } else if (query.discord_id) {
                        q = q.eq('discord_id', query.discord_id);
                    }
                }

                const { data, error } = await q;
                if (error) {
                    console.error('Error en User.find de Supabase:', error);
                    throw new Error(`Database error: ${error.message}`);
                }
                return data || [];
            }
        };

        const Webhook = {
            async findOne({ channel_id }) {
                const { data, error } = await supabase
                    .from('webhook_channels')
                    .select('*')
                    .eq('channel_id', channel_id)
                    .maybeSingle();

                if (error) {
                    console.error('Error en Webhook.findOne de Supabase:', error);
                    throw new Error(`Database error: ${error.message}`);
                }
                return data;
            },
            async find() {
                const { data, error } = await supabase
                    .from('webhook_channels')
                    .select('*');

                if (error) {
                    console.error('Error en Webhook.find de Supabase:', error);
                    throw new Error(`Database error: ${error.message}`);
                }
                return data || [];
            }
        };

        const res = { 'status': 1, 'response': "# Supabase conectado", 'User': User, 'Webhook': Webhook, 'supabaseClient': supabase };
        console.log(res.response);
        return res;
    } catch (error) {
        console.error('Error al conectar a Supabase', error);
        return { 'status': -1, 'response': "Error al conectar a Supabase" };
    }
}

async function addUser(User, discord_id, osu_id, main_gamemode) {
    const gamemode = main_gamemode == "" ? 'osu' : main_gamemode;

    try {
        const { data, error } = await supabase
            .from('users')
            .upsert({
                discord_id,
                osu_id,
                main_gamemode: gamemode
            }, { onConflict: 'discord_id' })
            .select()
            .single();

        if (error) throw error;

        return { 'status': 1, 'response': `Usuario ${discord_id} agregado/actualizado en Supabase`, 'callback': data };
    } catch (error) {
        console.error('Error al agregar/actualizar usuario en Supabase:', error);
        return { 'status': -1, 'response': 'Error al agregar/actualizar usuario en Supabase', 'callback': discord_id };
    }
}

async function deleteUser(User, discord_id) {
    try {
        const { data, error } = await supabase
            .from('users')
            .delete()
            .eq('discord_id', discord_id)
            .select()
            .maybeSingle();

        if (error) throw error;

        if (data) {
            return { 'status': 1, 'response': `Usuario ${discord_id} eliminado en Supabase`, 'callback': data };
        } else {
            return { 'status': 0, 'response': `Usuario ${discord_id} no encontrado en Supabase`, 'callback': null };
        }
    } catch (error) {
        console.error('Error al eliminar usuario en Supabase:', error);
        return { 'status': -1, 'response': 'Error al eliminar usuario en Supabase', 'callback': discord_id };
    }
}

async function addWebhookChannel(Webhook, channel_id, guild_id, guild_name, channel_name) {
    try {
        const { data, error } = await supabase
            .from('webhook_channels')
            .upsert({
                channel_id,
                guild_id,
                guild_name,
                channel_name
            }, { onConflict: 'channel_id' })
            .select()
            .single();

        if (error) throw error;

        return { 'status': 1, 'response': `Webhook para canal ${channel_id} agregado/actualizado en Supabase`, 'callback': data };
    } catch (error) {
        console.error('Error al agregar/actualizar webhook en Supabase:', error);
        return { 'status': -1, 'response': 'Error al agregar/actualizar webhook en Supabase', 'callback': channel_id };
    }
}

async function deleteWebhookChannel(Webhook, channel_id) {
    try {
        const { data, error } = await supabase
            .from('webhook_channels')
            .delete()
            .eq('channel_id', channel_id)
            .select()
            .maybeSingle();

        if (error) throw error;

        if (data) {
            return { 'status': 1, 'response': `Webhook para canal ${channel_id} eliminado en Supabase`, 'callback': data };
        } else {
            return { 'status': 0, 'response': `Webhook para canal ${channel_id} no encontrado en Supabase`, 'callback': null };
        }
    } catch (error) {
        console.error('Error al eliminar webhook en Supabase:', error);
        return { 'status': -1, 'response': 'Error al eliminar webhook en Supabase', 'callback': channel_id };
    }
}

function getSupabaseClient() {
    return supabase;
}

module.exports = { connectDB, addUser, deleteUser, addWebhookChannel, deleteWebhookChannel, getSupabaseClient };