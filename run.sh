#!/bin/bash

# Buscar y matar cualquier proceso de Node.js que esté corriendo
pid=$(ps aux | grep 'node index.js' | grep -v grep | awk '{print $2}')

if [ -n "$pid" ]; then
  kill "$pid"
fi

# Iniciar el bot
cd "C:\Users\Jeiden\Documents\Programacion\Javascript\proyectos\sengo_bot"
node index.js
