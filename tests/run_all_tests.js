const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const testFiles = [
    "tests/test_lint.js",
    "tests/test_leaderboards.js",
    "tests/test_m_views.js",
    "tests/test_snipes_views.js",
    "tests/test_osu_views.js",
    "tests/test_secondary_views.js",
    "tests/test_suggestions.js"
];

console.log("🚀 Iniciando suite de pruebas de regresión de Vistas (MVC Phase 1)...");

let hasErrors = false;
let logContent = `=== REGISTRO DE PRUEBAS DEL ${new Date().toLocaleString('es-ES')} ===\n`;

for (const file of testFiles) {
    const startMsg = `🏃 Ejecutando: node ${file}\n`;
    console.log(`\n--------------------------------------------------`);
    console.log(`🏃 Ejecutando: node ${file}`);
    console.log(`--------------------------------------------------`);
    logContent += startMsg;
    try {
        const output = execSync(`node ${file}`, { encoding: "utf-8" });
        console.log(output);
        const successMsg = `✅ ${file} completado con éxito.\n`;
        console.log(successMsg.trim());
        logContent += output + successMsg + "\n";
    } catch (err) {
        const errorMsg = `❌ ${file} falló.\nError: ${err.message || err}\n`;
        console.error(errorMsg.trim());
        if (err.stdout) {
            console.error(err.stdout);
            logContent += err.stdout;
        }
        if (err.stderr) {
            console.error(err.stderr);
            logContent += err.stderr;
        }
        logContent += errorMsg + "\n";
        hasErrors = true;
    }
}

const summaryHeader = `\n==================================================\n`;
console.log(summaryHeader.trim());
logContent += summaryHeader;

let summaryMsg = "";
if (hasErrors) {
    summaryMsg = "❌ La suite de pruebas falló. Revisa los errores arriba.\n";
    console.error(summaryMsg.trim());
} else {
    summaryMsg = "🎉 ¡Todas las pruebas de regresión visual de MVC pasaron con éxito! 100% Paridad.\n";
    console.log(summaryMsg.trim());
}
logContent += summaryMsg + "==================================================\n\n";

try {
    fs.appendFileSync(path.join(__dirname, "test_run_history.log"), logContent, "utf-8");
    console.log("📝 Logs de pruebas guardados en tests/test_run_history.log");
} catch (writeErr) {
    console.error("No se pudo escribir el archivo de historial de pruebas:", writeErr);
}

if (hasErrors) {
    process.exit(1);
} else {
    process.exit(0);
}
