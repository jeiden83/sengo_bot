const { mongoose } = require('mongoose');
const CONFIG = require("../config.json");

async function connectDB(config) {

    const userSchema = new mongoose.Schema({
        discord_id: { type: String, required: true, unique: true },
        osu_id: { type: String },
        main_gamemode: { type: String, default: "std" },
        osu_server: { type: String, default: "bancho" }
    });
    const User = mongoose.model('User', userSchema);
    const uri = CONFIG.DB_URI;

    try {
        console.log("# Conectando a MongoDB...");
        await mongoose.connect(uri);

        const res = {'status' : 1, 'response' : "# MongoDB conectado", 'User': User};
        console.log(res.response);

        return res;
    } catch (error) {
        console.error('Error al conectar a MongoDB', error);
        return { 'status': -1, 'response': "Error al conectar a MongoDB" };

    }
}
async function addUser(User, discord_id, osu_id, main_gamemode) {
    const gamemode = main_gamemode == "" ? 'std' : main_gamemode;
    
    try {
        
        let user = await User.findOne({ discord_id });

        if (user) {
            
            user.osu_id = osu_id;
            user.main_gamemode = gamemode;

            await user.save();
            return { 'status': 1, 'response': `Usuario ${discord_id} actualizado`, 'callback': user };
        } else {
            
            user = new User({ discord_id, osu_id, gamemode});
            await user.save();
            return { 'status': 1, 'response': `Usuario ${discord_id} agregado`, 'callback': user };
        }
    } catch (error) {
        console.error('Error al agregar/actualizar usuario:', error);
        return { 'status': -1, 'response': 'Error al agregar/actualizar usuario', 'callback': discord_id };
    }
}
async function deleteUser(User, discord_id) {
    try {
        // Busca y elimina al usuario por discord_id
        const user = await User.findOneAndDelete({ discord_id });

        if (user) {
            
            return { 'status': 1, 'response': `Usuario ${discord_id} eliminado`, 'callback': user };
        } else {
            
            return { 'status': 0, 'response': `Usuario ${discord_id} no encontrado`, 'callback': null };
        }
    } catch (error) {
        console.error('Error al eliminar usuario:', error);
        return { 'status': -1, 'response': 'Error al eliminar usuario', 'callback': discord_id };
    }
}

module.exports = {connectDB, addUser, deleteUser};