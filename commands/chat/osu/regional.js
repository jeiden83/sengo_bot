const nacional = require("./nacional.js");
const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    let modifiedArgs = args ? String(args).trim() : "";
    if (!modifiedArgs.includes("-regional") && !modifiedArgs.includes("-region")) {
        if (!modifiedArgs) {
            modifiedArgs = "-regional self";
        } else {
            const parts = modifiedArgs.split(",").map(p => p.trim()).filter(Boolean);
            let regionalVal = null;
            let finalParts = [];
            
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (part.startsWith("-") || part.startsWith("+")) {
                    finalParts.push(part);
                    continue;
                }
                
                const prev = finalParts[finalParts.length - 1];
                if (prev === "-pais" || prev === "-country" || prev === "-p" || prev === "-page" || prev === "-modo" || prev === "-m") {
                    finalParts.push(part);
                } else {
                    if (!regionalVal) {
                        regionalVal = part;
                    } else {
                        finalParts.push(part);
                    }
                }
            }
            
            if (regionalVal) {
                finalParts.push(`-regional ${regionalVal}`);
            } else {
                finalParts.push("-regional self");
            }
            
            modifiedArgs = finalParts.join(", ");
        }
    }
    return nacional.run(messages, modifiedArgs);
}

run.alias = {
    "regiones": { "args": "lista" }
};

run.description = {
    'header': t('es', 'commands.regional.header'),
    'body': t('es', 'commands.regional.body'),
    'usage': t('es', 'commands.regional.usage')
};

module.exports = { run, description: run.description };
