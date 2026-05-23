const { connectDB } = require("../db/database.js");
const config = require("../config.js");
const OsuUserModel = require("../models/OsuUserModel.js");
const { loadCommands, chatCommand } = require("../commands/handler.js");
const osuUtils = require("../commands/utils/osu.js");

// Mocking argsParser and getOsuUser of osu.js to avoid hitting the real osu! API
const originalArgsParser = osuUtils.argsParser;
osuUtils.argsParser = async (args, params) => {
    return {
        parsed_args: {
            detailed: true,
            gamemode: "osu",
            username: ["Jeiden"],
            country: params.command_function.name === 'getOsuUser' ? null : 'VE'
        },
        fn_response: {
            id: "11622889",
            username: "Jeiden",
            playmode: "osu",
            country_code: "VE",
            statistics: {
                global_rank: 12345,
                rank: { country: 123 }
            }
        },
        user_found: {
            discord_id: "395623267530047489",
            osu_id: "11622889",
            main_gamemode: "osu"
        }
    };
};

// Mocking getLinkedUser and getOAuthTokenRecord
const originalGetLinkedUser = OsuUserModel.getLinkedUser;
const originalGetOAuthTokenRecord = OsuUserModel.getOAuthTokenRecord;

OsuUserModel.getLinkedUser = async (User, discordId) => {
    if (discordId === "395623267530047489") {
        return {
            discord_id: "395623267530047489",
            osu_id: "11622889",
            main_gamemode: "osu"
        };
    }
    return null;
};

OsuUserModel.getOAuthTokenRecord = async (discordId) => {
    if (discordId === "395623267530047489") {
        return {
            discord_id: "395623267530047489",
            osu_id: "11622889",
            username: "Jeiden",
            country_code: "VE"
        };
    }
    return null;
};

async function runTests() {
    console.log("=================== [TEST: SUGERENCIAS DE OPTIMIZACIÓN] ===================");

    const dbRes = await connectDB(config);
    if (dbRes.status !== 1) {
        console.error("No se pudo conectar a la base de datos");
        process.exit(1);
    }

    const chat_commands = await loadCommands();
    const map = chat_commands.get('chat_commands_map');

    // Mockear el run de los comandos en el mapa
    map.get('osu').run = async (messages, args) => {
        return {
            embeds: [{ data: { author: { name: "Perfil osu! de Jeiden" }, description: "Stats info" } }]
        };
    };

    map.get('rs').run = async (messages, args) => {
        return {
            embeds: [{ data: { author: { name: "Puntuación Reciente de Jeiden en osu!" }, description: "Genryuu Kaiko" } }]
        };
    };

    map.get('lb').run = async (messages, args) => {
        return {
            content: "Tabla de clasificación",
            embeds: []
        };
    };

    const message1 = {
        author: { id: "395623267530047489", username: "Jeiden" },
        channel: {
            send: async (options) => { return options; }
        },
        reply: async (options) => { return options; }
    };
    
    // Caso 1: sd.r -osu
    console.log("# Probando 'r -osu'...");
    let res1 = await chatCommand(chat_commands, {
        command: "r",
        args: ["-osu"],
        message: message1,
        res: dbRes,
        reply: message1,
        logger: null
    });

    console.log("Result content 1:", res1 ? res1.content : "null");
    if (res1 && res1.content && res1.content.includes("Como tu modo de juego por defecto es standard")) {
        console.log("✅ Caso 1 (r -osu): PASSED");
    } else {
        console.error("❌ Caso 1 (r -osu): FAILED");
        process.exit(1);
    }

    // Caso 2: sd.o -osu
    console.log("# Probando 'o -osu'...");
    let res2 = await chatCommand(chat_commands, {
        command: "o",
        args: ["-osu"],
        message: message1,
        res: dbRes,
        reply: message1,
        logger: null
    });

    console.log("Result content 2:", res2 ? res2.content : "null");
    if (res2 && res2.content && res2.content.includes("Como tu modo de juego por defecto es standard")) {
        console.log("✅ Caso 2 (o -osu): PASSED");
    } else {
        console.error("❌ Caso 2 (o -osu): FAILED");
        process.exit(1);
    }

    // Caso 3: sd.lb -pais VE
    console.log("# Probando 'lb -pais VE'...");
    let res3 = await chatCommand(chat_commands, {
        command: "lb",
        args: ["-pais", "VE"],
        message: message1,
        res: dbRes,
        reply: message1,
        logger: null
    });

    console.log("Result content 3:", res3 ? res3.content : "null");
    if (res3 && res3.content && res3.content.includes("Como tu país ya es **VE**")) {
        console.log("✅ Caso 3 (lb -pais VE): PASSED");
    } else {
        console.error("❌ Caso 3 (lb -pais VE): FAILED");
        process.exit(1);
    }

    // Caso 4: sd.o Jeiden
    console.log("# Probando 'o Jeiden'...");
    let res4 = await chatCommand(chat_commands, {
        command: "o",
        args: ["Jeiden"],
        message: message1,
        res: dbRes,
        reply: message1,
        logger: null
    });

    console.log("Result content 4:", res4 ? res4.content : "null");
    if (res4 && res4.content && res4.content.includes("Como ya estás vinculado al bot, no necesitas escribir tu nombre")) {
        console.log("✅ Caso 4 (o Jeiden): PASSED");
    } else {
        console.error("❌ Caso 4 (o Jeiden): FAILED");
        process.exit(1);
    }

    console.log("🎉 ¡Todos los tests de sugerencias pasaron correctamente!");
    
    // Restaurar los mocks
    osuUtils.argsParser = originalArgsParser;
    OsuUserModel.getLinkedUser = originalGetLinkedUser;
    OsuUserModel.getOAuthTokenRecord = originalGetOAuthTokenRecord;
    
    process.exit(0);
}

runTests().catch(err => {
    console.error("Error en test suite:", err);
    process.exit(1);
});
