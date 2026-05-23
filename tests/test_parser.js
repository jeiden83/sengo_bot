const { argsParserNoCommand } = require("../commands/utils/argsParser.js");
const assert = require("assert");

console.log("=================== [TEST: PARSEO DE PARÁMETROS] ===================");

// Caso 1: -pais con código de país
const parsed1 = argsParserNoCommand(["-pais", "VE", "https://osu.ppy.sh/beatmaps/3607095"]);
assert.strictEqual(parsed1.country, "VE", "Debe parsear VE como país");
assert.strictEqual(parsed1.beatmap_url, "3607095", "Debe extraer la ID del beatmap");
console.log("✅ Caso 1 (-pais VE + URL): PASSED");

// Caso 2: -pais seguido de URL de beatmap
const parsed2 = argsParserNoCommand(["-pais", "https://osu.ppy.sh/beatmaps/3607095"]);
assert.strictEqual(parsed2.country, "SELF", "Debe dejar el país como SELF porque el siguiente es un beatmap");
assert.strictEqual(parsed2.beatmap_url, "3607095", "Debe extraer la ID del beatmap");
console.log("✅ Caso 2 (-pais + URL): PASSED");

// Caso 3: -pais seguido de ID de beatmap pura
const parsed3 = argsParserNoCommand(["-pais", "3607095"]);
assert.strictEqual(parsed3.country, "SELF", "Debe dejar el país como SELF porque el siguiente es un beatmap ID");
assert.strictEqual(parsed3.beatmap_url, "3607095", "Debe extraer la ID del beatmap");
console.log("✅ Caso 3 (-pais + ID pura): PASSED");

// Caso 4: -friends con nombre de usuario
const parsed4 = argsParserNoCommand(["-friends", "Jeiden", "https://osu.ppy.sh/beatmaps/3607095"]);
assert.strictEqual(parsed4.friendsFilter, "Jeiden", "Debe parsear Jeiden como amigos");
assert.strictEqual(parsed4.beatmap_url, "3607095", "Debe extraer la ID del beatmap");
console.log("✅ Caso 4 (-friends Jeiden + URL): PASSED");

// Caso 5: -friends seguido de URL
const parsed5 = argsParserNoCommand(["-friends", "https://osu.ppy.sh/beatmaps/3607095"]);
assert.strictEqual(parsed5.friendsFilter, "SELF", "Debe dejar friends como SELF porque el siguiente es un beatmap");
assert.strictEqual(parsed5.beatmap_url, "3607095", "Debe extraer la ID del beatmap");
console.log("✅ Caso 5 (-friends + URL): PASSED");

// Caso 6: inline -pais con URL
const parsed6 = argsParserNoCommand(["-paishttps://osu.ppy.sh/beatmaps/3607095"]);
assert.strictEqual(parsed6.country, "SELF", "Debe evitar URL en inline -pais");
assert.strictEqual(parsed6.beatmap_url, "3607095", "Debe extraer la ID del beatmap");
console.log("✅ Caso 6 (inline -pais + URL): PASSED");

// Caso 7: argsParser con sugerencia de vinculación conteniendo el prefijo correcto
const { argsParser } = require("../commands/utils/argsParser.js");
const OsuUserModel = require("../models/OsuUserModel.js");
const config = require("../config.js");

const originalGetLinkedUser = OsuUserModel.getLinkedUser;
OsuUserModel.getLinkedUser = async () => null;

const mockMessage = {
    author: {
        id: "123456",
        username: "TestUser"
    }
};

const mockRes = {
    User: {}
};

async function runAsyncTests() {
    try {
        const result = await argsParser([], {
            message: mockMessage,
            res: mockRes,
            command_function: async () => {}
        });

        const prefix = config.BOT_PREFIX || "s.";
        const expectedMessage = `❌ No se encontró ningún usuario de \`osu!\` vinculado a tu cuenta de Discord (\`TestUser\`).\n- **Vincula** tu cuenta de forma segura usando el comando de chat \`${prefix}link -oauth\` o slash \`/link -oauth\`.`;

        assert.strictEqual(result.fn_response, expectedMessage, "Debe contener el prefijo del bot configurado en vez de undefined");
        console.log("✅ Caso 7 (argsParser sugerencia link con prefijo correcto): PASSED");

        OsuUserModel.getLinkedUser = originalGetLinkedUser;
        console.log("🎉 ¡Todos los tests de parseo de parámetros pasaron con éxito!");
    } catch (err) {
        console.error("❌ Error en tests de parseo:", err);
        process.exit(1);
    }
}

runAsyncTests();

