const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COLORS = {
    reset: "\x1b[0m",
    gray: "\x1b[90m",
    cyan: "\x1b[36m",      // Trigger
    yellow: "\x1b[33m",    // Process
    green: "\x1b[32m",     // Success
    red: "\x1b[31m",       // Failed
    magenta: "\x1b[35m"    // System
};

class Logger {
    constructor(message, commandName, args) {
        this.id = crypto.randomBytes(3).toString('hex');
        this.startTime = Date.now();
        this.user = message ? message.author.tag : "SYSTEM";
        this.guild = message ? (message.guild ? message.guild.name : "DM") : "SYSTEM";
        this.command = commandName || "SYSTEM";
        this.args = args ? (args.filter(Boolean).join(" ") || "(Ninguno)") : "";
    }

    static getTimestamp() {
        const d = new Date();
        return d.toTimeString().split(' ')[0]; // HH:MM:SS
    }

    static getLocalDateString() {
        const d = new Date();
        return d.toISOString().split('T')[0]; // YYYY-MM-DD
    }

    // Escribe el log de forma persistente en local (sin caracteres ANSI de color)
    static writeToLogFile(rawText) {
        try {
            const logsDir = path.join(process.cwd(), 'db/local/logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            const logFile = path.join(logsDir, `${Logger.getLocalDateString()}.log`);
            const timestamp = Logger.getTimestamp();
            fs.appendFileSync(logFile, `[${timestamp}] ${rawText}\n`, 'utf8');
        } catch (error) {
            console.error("Error escribiendo en el archivo de log:", error);
        }
    }

    // EVENTOS DE SISTEMA: Inicio, Conexión DB y Apagado
    static system(message) {
        const header = `${COLORS.magenta}[SYSTEM]${COLORS.reset}`;
        const time = `${COLORS.gray}[${Logger.getTimestamp()}]${COLORS.reset}`;
        
        console.log(`${header} ${time} -> ${message}`);
        Logger.writeToLogFile(`[SYSTEM] -> ${message}`);
    }

    // PASO 1: Inicio / Trigger del comando
    trigger(planDescription = "Iniciando ejecución") {
        const header = `${COLORS.cyan}[TRIGGER]${COLORS.reset}`;
        const time = `${COLORS.gray}[${Logger.getTimestamp()}]${COLORS.reset}`;
        const meta = `[${this.user}] [${this.guild}] [s.${this.command}]`;
        const step = `${COLORS.cyan}[PASO 1/3: INICIO]${COLORS.reset}`;
        
        console.log(`${header} ${time} ${meta} ${step} -> ${planDescription} | Params: "${this.args}" ${COLORS.gray}[ID: ${this.id}]${COLORS.reset}`);
        
        Logger.writeToLogFile(`[TRIGGER] [${this.user}] [${this.guild}] [s.${this.command}] [PASO 1/3: INICIO] -> ${planDescription} | Params: "${this.args}" [ID: ${this.id}]`);
    }

    // PASO 2: En proceso (Peticiones externas / DB)
    process(actionDescription) {
        const header = `${COLORS.yellow}[PROCESS]${COLORS.reset}`;
        const time = `${COLORS.gray}[${Logger.getTimestamp()}]${COLORS.reset}`;
        const meta = `[${this.user}] [${this.guild}] [s.${this.command}]`;
        const step = `${COLORS.yellow}[PASO 2/3: PROCESANDO]${COLORS.reset}`;
        
        console.log(`${header} ${time} ${meta} ${step} -> ${actionDescription}... ${COLORS.gray}[ID: ${this.id}]${COLORS.reset}`);
        
        Logger.writeToLogFile(`[PROCESS] [${this.user}] [${this.guild}] [s.${this.command}] [PASO 2/3: PROCESANDO] -> ${actionDescription}... [ID: ${this.id}]`);
    }

    // PASO 3 (ÉXITO): Completado de forma exitosa
    success(details) {
        const duration = Date.now() - this.startTime;
        const header = `${COLORS.green}[SUCCESS]${COLORS.reset}`;
        const time = `${COLORS.gray}[${Logger.getTimestamp()}]${COLORS.reset}`;
        const meta = `[${this.user}] [${this.guild}] [s.${this.command}]`;
        const step = `${COLORS.green}[PASO 3/3: COMPLETADO]${COLORS.reset}`;
        
        console.log(`${header} ${time} ${meta} ${step} -> ${COLORS.green}${details}${COLORS.reset} ${COLORS.gray}(Latencia: ${duration}ms) [ID: ${this.id}]${COLORS.reset}`);
        
        Logger.writeToLogFile(`[SUCCESS] [${this.user}] [${this.guild}] [s.${this.command}] [PASO 3/3: COMPLETADO] -> ${details} (Latencia: ${duration}ms) [ID: ${this.id}]`);
    }

    // PASO 3 (FALLO): Ejecución fallida o controlada
    failed(reason) {
        const duration = Date.now() - this.startTime;
        const header = `${COLORS.red}[FAILED ]${COLORS.reset}`;
        const time = `${COLORS.gray}[${Logger.getTimestamp()}]${COLORS.reset}`;
        const meta = `[${this.user}] [${this.guild}] [s.${this.command}]`;
        const step = `${COLORS.red}[PASO 3/3: FALLIDO]${COLORS.reset}`;
        
        console.log(`${header} ${time} ${meta} ${step} -> ${COLORS.red}Error: ${reason}${COLORS.reset} ${COLORS.gray}(Latencia: ${duration}ms) [ID: ${this.id}]${COLORS.reset}`);
        
        Logger.writeToLogFile(`[FAILED ] [${this.user}] [${this.guild}] [s.${this.command}] [PASO 3/3: FALLIDO] -> Error: ${reason} (Latencia: ${duration}ms) [ID: ${this.id}]`);
    }
}

module.exports = Logger;
