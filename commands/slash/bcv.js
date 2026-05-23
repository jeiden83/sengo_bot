const { SlashCommandBuilder } = require("discord.js");
const bcvChatCommand = require("../chat/utils/bcv.js");

const data = new SlashCommandBuilder()
    .setName("bcv")
    .setDescription("Consulta la tasa oficial de cambio del Banco Central de Venezuela")
    .addStringOption(option => 
        option.setName("moneda")
            .setDescription("Moneda a consultar (Por defecto: Dólar)")
            .setRequired(false)
            .addChoices(
                { name: "Dólar (USD) 🇺🇸", value: "dolar" },
                { name: "Euro (EUR) 🇪🇺", value: "euro" },
                { name: "Yuan (CNY) 🇨🇳", value: "yuan" },
                { name: "Lira (TRY) 🇹🇷", value: "lira" },
                { name: "Rublo (RUB) 🇷🇺", value: "rublo" }
            )
    );

async function run(interaction, res) {
    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member,
            guild: interaction.guild,
            channel: interaction.channel,
        },
        res: res,
        reply: null,
        logger: interaction.logger
    };

    const moneda = interaction.options.getString("moneda") || "dolar";
    const args = [moneda];

    const result = await bcvChatCommand.run(messages, args);

    if (result) {
        await interaction.editReply(result);
    }
    return true;
}

run.description = "Consulta la tasa oficial de cambio del Banco Central de Venezuela";

module.exports = { data, run, description: run.description };
