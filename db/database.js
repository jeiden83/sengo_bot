const CONFIG = require("../config.json");

const useSupabase = process.argv.includes('--supabase');

let mongoose;
let createClient;
let supabase;

if (useSupabase) {
    createClient = require('@supabase/supabase-js').createClient;
    console.log("ℹ️ Database mode: SUPABASE (--supabase flag detected)");
} else {
    mongoose = require('mongoose').mongoose;
    console.log("ℹ️ Database mode: MONGODB (default)");
}

async function connectDB(config) {
    if (useSupabase) {
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
    } else {
        const userSchema = new mongoose.Schema({
            discord_id: { type: String, required: true, unique: true },
            osu_id: { type: String },
            main_gamemode: { type: String },
            osu_server: { type: String, default: "bancho" }
        });
        const User = mongoose.model('User', userSchema);

        const webhookSchema = new mongoose.Schema({
            channel_id: { type: String, required: true, unique: true },
            guild_id: { type: String, required: true },
            guild_name: { type: String },
            channel_name: { type: String },
            created_at: { type: Date, default: Date.now }
        });
        const Webhook = mongoose.model('WebhookChannel', webhookSchema);

        try {
            console.log("# Conectando a MongoDB...");

            await mongoose.connect(CONFIG.DB_URI, { serverSelectionTimeoutMS: 10000 });

            const res = { 'status': 1, 'response': "# MongoDB conectado", 'User': User, 'Webhook': Webhook };
            console.log(res.response);

            return res;
        } catch (error) {
            console.error('Error al conectar a MongoDB', error);
            return { 'status': -1, 'response': "Error al conectar a MongoDB" };
        }
    }
}

async function addUser(User, discord_id, osu_id, main_gamemode) {
    const gamemode = main_gamemode == "" ? 'osu' : main_gamemode;

    if (useSupabase) {
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
    } else {
        try {
            let user = await User.findOne({ discord_id });

            if (user) {
                user.osu_id = osu_id;
                user.main_gamemode = gamemode;

                await user.save();
                return { 'status': 1, 'response': `Usuario ${discord_id} actualizado`, 'callback': user };
            } else {
                user = new User({ discord_id, osu_id, main_gamemode: gamemode });
                await user.save();
                return { 'status': 1, 'response': `Usuario ${discord_id} agregado`, 'callback': user };
            }
        } catch (error) {
            console.error('Error al agregar/actualizar usuario en MongoDB:', error);
            return { 'status': -1, 'response': 'Error al agregar/actualizar usuario en MongoDB', 'callback': discord_id };
        }
    }
}

async function deleteUser(User, discord_id) {
    if (useSupabase) {
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
    } else {
        try {
            const user = await User.findOneAndDelete({ discord_id });

            if (user) {
                return { 'status': 1, 'response': `Usuario ${discord_id} eliminado`, 'callback': user };
            } else {
                return { 'status': 0, 'response': `Usuario ${discord_id} no encontrado`, 'callback': null };
            }
        } catch (error) {
            console.error('Error al eliminar usuario en MongoDB:', error);
            return { 'status': -1, 'response': 'Error al eliminar usuario en MongoDB', 'callback': discord_id };
        }
    }
}

async function addWebhookChannel(Webhook, channel_id, guild_id, guild_name, channel_name) {
    if (useSupabase) {
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
    } else {
        try {
            let webhook = await Webhook.findOne({ channel_id });

            if (webhook) {
                webhook.guild_id = guild_id;
                webhook.guild_name = guild_name;
                webhook.channel_name = channel_name;

                await webhook.save();
                return { 'status': 1, 'response': `Webhook para canal ${channel_id} actualizado`, 'callback': webhook };
            } else {
                webhook = new Webhook({ channel_id, guild_id, guild_name, channel_name });
                await webhook.save();
                return { 'status': 1, 'response': `Webhook para canal ${channel_id} agregado`, 'callback': webhook };
            }
        } catch (error) {
            console.error('Error al agregar/actualizar webhook en MongoDB:', error);
            return { 'status': -1, 'response': 'Error al agregar/actualizar webhook en MongoDB', 'callback': channel_id };
        }
    }
}

async function deleteWebhookChannel(Webhook, channel_id) {
    if (useSupabase) {
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
    } else {
        try {
            const webhook = await Webhook.findOneAndDelete({ channel_id });

            if (webhook) {
                return { 'status': 1, 'response': `Webhook para canal ${channel_id} eliminado`, 'callback': webhook };
            } else {
                return { 'status': 0, 'response': `Webhook para canal ${channel_id} no encontrado`, 'callback': null };
            }
        } catch (error) {
            console.error('Error al eliminar webhook en MongoDB:', error);
            return { 'status': -1, 'response': 'Error al eliminar webhook en MongoDB', 'callback': channel_id };
        }
    }
}

module.exports = { connectDB, addUser, deleteUser, addWebhookChannel, deleteWebhookChannel };