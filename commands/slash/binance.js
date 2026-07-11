const { SlashCommandBuilder } = require("discord.js");
const binanceChatCommand = require("../chat/utils/binance.js");

const data = new SlashCommandBuilder()
    .setName("binance")
    .setDescription("Consulta la tasa promedio P2P en Binance con opciones personalizadas")
    .addStringOption(option => 
        option.setName("tipo")
            .setDescription("Tipo de operación (Por defecto: Venta)")
            .setRequired(false)
            .addChoices(
                { name: "Compra 🟢", value: "buy" },
                { name: "Venta 🔴", value: "sell" }
            )
    )
    .addStringOption(option => 
        option.setName("crypto")
            .setDescription("Criptomoneda a consultar (Ej: USDT, BTC). Por defecto: USDT")
            .setRequired(false)
    )
    .addStringOption(option => 
        option.setName("fiat")
            .setDescription("Moneda local a consultar (Ej: VES, COP). Por defecto: VES")
            .setRequired(false)
    )
    .addStringOption(option => 
        option.setName("monto")
            .setDescription("Filtrar anuncios por límites de monto. Por defecto: 500000 para VES")
            .setRequired(false)
    )
    .addStringOption(option => 
        option.setName("metodos")
            .setDescription("Métodos de pago separados por comas (Ej: pago movil, banesco)")
            .setRequired(false)
    )
    .addStringOption(option => 
        option.setName("verificado")
            .setDescription("Filtrar por nivel de verificación del anunciante. Por defecto: Todos")
            .setRequired(false)
            .addChoices(
                { name: "Todos", value: "all" },
                { name: "Solo Verificados", value: "verified" },
                { name: "Solo No Verificados", value: "unverified" }
            )
    )
    .addBooleanOption(option => 
        option.setName("detallado")
            .setDescription("Mostrar la información en un Discord Embed detallado")
            .setRequired(false)
    );

async function run(interaction, res) {
    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    const tipo = interaction.options.getString("tipo");
    const crypto = interaction.options.getString("crypto");
    const fiat = interaction.options.getString("fiat");
    const monto = interaction.options.getString("monto");
    const metodos = interaction.options.getString("metodos");
    const verificado = interaction.options.getString("verificado");
    const detallado = interaction.options.getBoolean("detallado");

    const args = [];

    if (tipo === "buy") args.push("-buy");
    if (tipo === "sell") args.push("-sell");
    
    if (crypto) {
        args.push("-cripto");
        args.push(crypto);
    }
    if (fiat) {
        args.push("-fiat");
        args.push(fiat);
    }
    if (monto) {
        args.push("-amount");
        args.push(monto);
    }
    if (metodos) {
        args.push("-methods");
        args.push(metodos);
    }
    if (verificado === "verified") args.push("-verified");
    if (verificado === "unverified") args.push("-unverified");
    if (detallado) args.push("-d");

    // Redirigir el envío si el comando de chat retorna un objeto con embed
    const result = await binanceChatCommand.run(messages, args);

    if (result) {
        await interaction.editReply(result);
    }
    return true;
}

run.description = "Consulta la tasa promedio P2P en Binance con opciones personalizadas";

module.exports = { data, run, description: run.description };
