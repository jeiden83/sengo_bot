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
        // Simular que falla si pasaron parámetros extraños
        if (args.includes("-c")) {
            return "❌ Error: Parámetro de comparación inválido.";
        }
        return {
            content: "Tabla de clasificación",
            embeds: []
        };
    };

    map.get('c').run = async (messages, args) => {
        // Simular que el comando c falla al no encontrar scores o por parámetros inválidos
        return "❌ Error: No se encontraron puntuaciones del usuario.";
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

    // Caso 5: sd.c -lb mx
    console.log("# Probando 'c -lb mx'...");
    let res5 = await chatCommand(chat_commands, {
        command: "c",
        args: ["-lb", "mx"],
        message: message1,
        res: dbRes,
        reply: message1,
        logger: null
    });

    console.log("Result 5:", res5);
    if (res5 && typeof res5 === 'string' && res5.includes("**El comando** `.c` no tiene un parámetro `-lb` o `-pais`") && res5.includes("MÉXICO (MX)")) {
        console.log("✅ Caso 5 (c -lb mx): PASSED");
    } else {
        console.error("❌ Caso 5 (c -lb mx): FAILED");
        process.exit(1);
    }

    // Caso 6: sd.c -lb (con detección de país desde el autor: VE)
    console.log("# Probando 'c -lb'...");
    let res6 = await chatCommand(chat_commands, {
        command: "c",
        args: ["-lb"],
        message: message1,
        res: dbRes,
        reply: message1,
        logger: null
    });

    console.log("Result 6:", res6);
    if (res6 && typeof res6 === 'string' && res6.includes("**El comando** `.c` no tiene un parámetro `-lb` o `-pais`") && res6.includes("VENEZUELA (VE)")) {
        console.log("✅ Caso 6 (c -lb): PASSED");
    } else {
        console.error("❌ Caso 6 (c -lb): FAILED");
        process.exit(1);
    }

    // Caso 7: sd.lb -c
    console.log("# Probando 'lb -c'...");
    let res7 = await chatCommand(chat_commands, {
        command: "lb",
        args: ["-c"],
        message: message1,
        res: dbRes,
        reply: message1,
        logger: null
    });

    console.log("Result 7:", res7);
    if (res7 && typeof res7 === 'string' && res7.includes("El comando `.lb` (leaderboard) no tiene un parámetro de comparación `-c`")) {
        console.log("✅ Caso 7 (lb -c): PASSED");
    } else {
        console.error("❌ Caso 7 (lb -c): FAILED");
        process.exit(1);
    }

    // Caso 8: sd.c -lb con error de tipo "El usuario no se encuentra en osu!"
    console.log("# Probando 'c -lb' con respuesta 'El usuario no se encuentra en osu!'...");
    map.get('c').run = async (messages, args) => {
        return "El usuario no se encuentra en osu!";
    };
    let res8 = await chatCommand(chat_commands, {
        command: "c",
        args: ["-lb"],
        message: message1,
        res: dbRes,
        reply: message1,
        logger: null
    });

    console.log("Result 8:", res8);
    if (res8 && typeof res8 === 'string' && res8.includes("**El comando** `.c` no tiene un parámetro `-lb` o `-pais`") && res8.includes("VENEZUELA (VE)")) {
        console.log("✅ Caso 8 (c -lb - no se encuentra): PASSED");
    } else {
        console.error("❌ Caso 8 (c -lb - no se encuentra): FAILED");
        process.exit(1);
    }

    // Caso 9: sd.osu -oauth
    console.log("# Probando 'osu -oauth'...");
    let res9 = await chatCommand(chat_commands, {
        command: "osu",
        args: ["-oauth"],
        message: message1,
        res: dbRes,
        reply: message1,
        logger: null
    });

    console.log("Result 9:", res9);
    if (res9 && typeof res9 === 'string' && res9.includes("**El parámetro** `-oauth` solo es válido en el comando `.link -oauth`")) {
        console.log("✅ Caso 9 (osu -oauth): PASSED");
    } else {
        console.error("❌ Caso 9 (osu -oauth): FAILED");
        process.exit(1);
    }

    // Caso 10: sd.rs https://osu.ppy.sh/b/12345
    console.log("# Probando 'rs https://osu.ppy.sh/b/12345'...");
    let res10 = await chatCommand(chat_commands, {
        command: "rs",
        args: ["https://osu.ppy.sh/b/12345"],
        message: message1,
        res: dbRes,
        reply: message1,
        logger: null
    });

    console.log("Result 10:", res10);
    if (res10 && typeof res10 === 'string' && res10.includes("no admite enlaces de beatmaps") && res10.includes("¿Habrás querido usar `.c`")) {
        console.log("✅ Caso 10 (rs beatmap_url): PASSED");
    } else {
        console.error("❌ Caso 10 (rs beatmap_url): FAILED");
        process.exit(1);
    }

    console.log("🎉 ¡Todos los tests de sugerencias inteligentes y de optimización pasaron correctamente!");
    
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
