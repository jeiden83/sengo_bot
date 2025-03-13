const { addUser, deleteUser } = require("../../../db/database.js"); 
const { getOsuUser, argsParserNoCommand} = require("../../utils/osu.js"); 

async function run(messages, args){
    const {message, res} = messages;

    try {
        const discord_id = message.author.id;
        const parsed_args = argsParserNoCommand(args);

        // Si no hay un nombre 
        if(parsed_args.username[0].length == 0){

            await deleteUser(res.User, discord_id)
            return `Se ha **desvinculado** el usuario \`${message.author.username}\` del **bot** correctamente.`
        }

        // Hay un nombre en el argumento
        const osu_user = await getOsuUser(parsed_args);

        if (typeof osu_user === "string") return `El usuario de osu! ${parsed_args.username[0]} no existe.`;
        
        return addUser(res.User, discord_id, osu_user.id, parsed_args.gamemode)
            .then(res => (res.status === 1)?
                `Se ha **vinculado** al usuario de osu! \`${osu_user.username}\` correctamente.` : `Error al vincular el usuario.`
        )
    } catch (error) {
        console.error('Error en el comando link:', error);
        return `Ocurrió un error al intentar vincular tu cuenta.`;
    }
};

run.description = 
{
    'header' : 'Para vincularse al bot',
    'body' : 'Te vincula el usuario de discord con un usuario de osu! dado, la cual se guarda en la db del Sengo.',
    'usage' : `s.link : Desvincula el usuario del bot.\ns.link 'usuario_osu' : Vincula tu discord con este usuario de osu al bot al std.\ns.link 'usuario_osu' 'modo_juego' : Vincula con respecto al modo de juego dado.`
}

module.exports = { run }