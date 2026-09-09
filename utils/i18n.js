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

/**
 * Formatea un número con separadores de miles según el idioma.
 * Fuerza el agrupamiento de miles incluso para números de 4 dígitos (1.000 a 9.999),
 * corrigiendo el comportamiento por defecto de CLDR para es-ES (minimumGroupingDigits: 2).
 * ponytail: usa Intl nativo con useGrouping: true para evitar regex frágiles.
 * @param {number|string} num - Número a formatear
 * @param {string} [locale='es'] - Código de idioma ('es' o 'en')
 * @param {object} [options={}] - Opciones adicionales de Intl.NumberFormat
 * @returns {string}
 */
function formatNumber(num, locale = 'es', options = {}) {
    if (num === null || num === undefined) return '0';
    const val = Number(num);
    if (isNaN(val)) return String(num);
    const tag = (locale && String(locale).toLowerCase().startsWith('en')) ? 'en-US' : 'es-ES';
    return val.toLocaleString(tag, { useGrouping: true, ...options });
}

/**
 * Formatea un número decimal con separadores localizados (coma decimal y punto de miles en es-ES; punto decimal y coma de miles en en-US).
 * ponytail: estandariza el renderizado de decimales (pp, estrellas, precisión) según el idioma del bot.
 * @param {number|string} num - Número a formatear
 * @param {string} [locale='es'] - Código de idioma ('es' o 'en')
 * @param {number} [decimals=2] - Cantidad fija de decimales
 * @returns {string}
 */
function formatDecimal(num, locale = 'es', decimals = 2) {
    if (num === null || num === undefined) return '0';
    const val = Number(num);
    if (isNaN(val)) return String(num);
    const tag = (locale && String(locale).toLowerCase().startsWith('en')) ? 'en-US' : 'es-ES';
    return val.toLocaleString(tag, {
        useGrouping: true,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

// Cargar las traducciones al importar el módulo
loadTranslations();

module.exports = {
    t,
    formatNumber,
    formatDecimal,
    loadTranslations,
    locales
};
