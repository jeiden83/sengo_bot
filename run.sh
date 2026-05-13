#!/bin/bash
# Cerrar cualquier instancia previa de Sengo Bot
echo "Limpiando procesos anteriores..."
# Intentar por comando (wildcard)
wmic process where "name='node.exe' and commandline like '%sengo_bot%'" call terminate > /dev/null 2>&1
# Intentar por el tag específico si el anterior falló
wmic process where "name='node.exe' and commandline like '%sengo_bot_process%'" call terminate > /dev/null 2>&1

# Pequeña pausa para asegurar liberación de recursos
sleep 1

# Ir a la carpeta e iniciar
cd "C:/Users/Jeiden/Documents/Programacion/Javascript/proyectos/sengo_bot"
echo "Iniciando Sengo Bot..."
node index.js sengo_bot_process