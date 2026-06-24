module.exports = [
    {
        ignores: ["scratch/**"]
    },
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                process: "readonly",
                require: "readonly",
                module: "readonly",
                __dirname: "readonly",
                __filename: "readonly",
                console: "readonly",
                setTimeout: "readonly",
                setInterval: "readonly",
                clearTimeout: "readonly",
                clearInterval: "readonly",
                Promise: "readonly",
                Buffer: "readonly",
                Set: "readonly",
                Map: "readonly",
                exports: "readonly",
                URL: "readonly",
                URLSearchParams: "readonly",
                fetch: "readonly",
                Headers: "readonly",
                Request: "readonly",
                Response: "readonly",
                AbortController: "readonly",
                performance: "readonly"
            }
        },
        rules: {
            "no-unused-vars": ["warn", { 
                "vars": "all", 
                "args": "none", 
                "ignoreRestSiblings": true 
            }],
            "no-undef": "error",
            "no-empty": ["warn", { "allowEmptyCatch": true }]
        }
    }
];
