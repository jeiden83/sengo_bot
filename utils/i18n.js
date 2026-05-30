const fs = require('fs');
const path = require('path');

const locales = {};
const DEFAULT_LOCALE = 'es';

/**
 * Carga todos los archivos JSON de traducciones desde el directorio de locales.
 */
function loadTranslations() {
    const localesPath = path.join(__dirname, '../locales');
    if (!fs.existsSync(localesPath)) {
        fs.mkdirSync(localesPath, { recursive: true });
    }
    const files = fs.readdirSync(localesPath);
    for (const file of files) {
        if (file.endsWith('.json')) {
            const lang = path.basename(file, '.json');
            try {
                const content = fs.readFileSync(path.join(localesPath, file), 'utf8');
                locales[lang] = JSON.parse(content);
            } catch (err) {
                console.error(`Error al parsear el archivo de idioma ${file}:`, err);
            }
        }
    }
}

/**
 * Obtiene la traducción correspondiente para una clave dada, realizando fallback si es necesario.
 * @param {string} locale Código de idioma (ej: 'es', 'en')
 * @param {string} key Clave jerárquica de traducción (ej: 'general.loading')
 * @param {object} variables Objeto con variables a interpolar (ej: { username: 'Jeiden' })
 * @returns {string} Texto traducido o la clave si no se encuentra
 */
function t(locale, key, variables = {}) {
    const lang = (locale && locales[locale]) ? locale : DEFAULT_LOCALE;
    
    let translation = key.split('.').reduce((obj, i) => (obj ? obj[i] : null), locales[lang]);
    
    // Fallback al idioma por defecto si no existe la clave en el idioma solicitado
    if (translation === undefined || translation === null) {
        if (lang !== DEFAULT_LOCALE) {
            translation = key.split('.').reduce((obj, i) => (obj ? obj[i] : null), locales[DEFAULT_LOCALE]);
        }
    }

    if (translation === undefined || translation === null) {
        return key;
    }

    if (typeof translation !== 'string') {
        return key;
    }

    // Interpolación de variables
    let result = translation;
    for (const [v, val] of Object.entries(variables)) {
        result = result.replace(new RegExp(`{${v}}`, 'g'), String(val));
    }

    return result;
}

// Cargar las traducciones al importar el módulo
loadTranslations();

module.exports = {
    t,
    loadTranslations,
    locales
};
