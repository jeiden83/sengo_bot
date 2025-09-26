const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../../../config.json");
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);

const historyFilePath = path.join(__dirname, '..', '..', '..', 'data', 'conversation_history.json');
const historyDir = path.dirname(historyFilePath);

const MAX_DISCORD_MESSAGE_LENGTH = 2000;

if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
}

function readHistory() {
    if (!fs.existsSync(historyFilePath)) return {};
    try {
        return JSON.parse(fs.readFileSync(historyFilePath, 'utf-8'));
    } catch (error) {
        console.error("Error al leer el historial de conversación:", error);
        return {};
    }
}

function writeHistory(data) {
    try {
        fs.writeFileSync(historyFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Error al escribir el historial de conversación:", error);
    }
}

function logInteraction(logData, serverName, userId) {
    const serverFolder = serverName ? serverName.replace(/[^a-zA-Z0-9_-]/g, '_') : 'direct_messages';
    const logsDir = path.join(__dirname, '..', '..', '..', 'data', 'logs', serverFolder);
    const logFilePath = path.join(logsDir, `${userId}.json`);

    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    let logs = [];
    if (fs.existsSync(logFilePath)) {
        try {
            const fileContent = fs.readFileSync(logFilePath, 'utf-8');
            if (fileContent) logs = JSON.parse(fileContent);
        } catch (error) {
            console.error(`Error al leer el archivo de log para el usuario ${userId}:`, error);
        }
    }
    logs.push(logData);
    
    fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2));
}

async function processImage(url) {
    try {
        const response = await fetch(url);
        const buffer = await response.buffer();
        const base64Data = buffer.toString('base64');
        const mimeType = response.headers.get('content-type');
        return {
            inlineData: {
                data: base64Data,
                mimeType: mimeType
            }
        };
    } catch (error) {
        console.error("Error al procesar la imagen:", error);
        return null;
    }
}

async function run(messages, args) {
    const { message, reply } = messages;

    let prompt;
    if (reply && reply.content) {
        prompt = reply.content;
        if (args && args.length > 0) {
            prompt += ' ' + args.join(' ');
        }
    } else {
        prompt = args.join(' ');
    }

    if (!prompt && (!message.attachments || message.attachments.size === 0)) {
        return 'Y si preguntas algo.';
    }

    const userId = message.author.id;
    const serverName = message.guild ? message.guild.name : null;
    const histories = readHistory();

    if (prompt.toLowerCase() === 'reset') {
        if (histories[userId]) {
            delete histories[userId];
            writeHistory(histories);
            return 'He olvidado nuestra conversación anterior. ¡Podemos empezar de nuevo!';
        }
        return 'No tengo ninguna conversación guardada contigo para olvidar.';
    }

    const baseGuidelines = [
        {
            role: "user",
            parts: [{ text: "A partir de ahora, mi nombre es Sengo. Mi creador es Jeiden. Soy un bot de Discord que me encargo de contestar las preguntas que me hagan." }]
        },
        {
            role: "model",
            parts: [{ text: "Entendido, mi nombre es Sengo, mi creador es Jeiden. Soy un bot de Discord que se encarga de contestar las preguntas que me hagan." }]
        }
    ];

    const userHistory = histories[userId] || [];
    const chatHistory = [...baseGuidelines, ...userHistory];

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        let messageParts = [];
        if (prompt) {
            messageParts.push({ text: prompt });
        }
        
        if (message.attachments.size > 0) {
            const attachment = message.attachments.first();
            if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                const imagePart = await processImage(attachment.url);
                if (imagePart) {
                    messageParts.push(imagePart);
                }
            }
        }
        
        chatHistory.push({
            role: "user",
            parts: messageParts
        });
        
        const chat = model.startChat({ history: chatHistory });
        
        const result = await chat.sendMessage(prompt);
        let text = result.response.text();

        if (text.length > MAX_DISCORD_MESSAGE_LENGTH) {
            console.log("Respuesta de Gemini demasiado larga. Solicitando una versión más corta...");
            const shorterPrompt = `Resúmeme este texto para que no sea más largo de ${MAX_DISCORD_MESSAGE_LENGTH} caracteres: "${text}"`;
            
            const shorterResult = await chat.sendMessage(shorterPrompt);
            const shorterText = shorterResult.response.text();

            if (shorterText.length > MAX_DISCORD_MESSAGE_LENGTH) {
                logInteraction({
                    timestamp: new Date().toISOString(),
                    userId: message.author.id,
                    userName: message.author.username,
                    serverId: message.guild ? message.guild.id : 'DM',
                    serverName: message.guild ? message.guild.name : 'DM',
                    prompt: prompt,
                    response: "Respuesta demasiado larga incluso después de resumir."
                }, serverName, userId);
                return "La respuesta es demasiado larga y no se pudo resumir a un tamaño apropiado.";
            }

            text = shorterText;
        }
        
        logInteraction({
            timestamp: new Date().toISOString(),
            userId: message.author.id,
            userName: message.author.username,
            serverId: message.guild ? message.guild.id : 'DM',
            serverName: message.guild ? message.guild.name : 'DM',
            prompt: prompt,
            response: text
        }, serverName, userId);

        const newHistoryFromAPI = await chat.getHistory();
        histories[userId] = newHistoryFromAPI;
        writeHistory(histories);

        return text;
    } catch (error) {
        console.error('Error al contactar la API de Gemini:', error);
        return 'Hubo un error al procesar tu pregunta. Inténtalo de nuevo más tarde.';
    }
}

module.exports = { run };