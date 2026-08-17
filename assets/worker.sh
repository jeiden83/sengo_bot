#!/usr/bin/env bash

KEY="__WORKER_KEY__"
COUNTRY="__WORKER_COUNTRY__"
SERVER="__SERVER_URL__"

if [ -z "$KEY" ]; then
    echo -e "\033[0;31mError: Se requiere especificar la clave de trabajador (Key).\033[0m"
    exit 1
fi

if [ -z "$COUNTRY" ]; then
    echo -e "\033[0;31mError: Se requiere especificar el código de país (Country).\033[0m"
    exit 1
fi

echo -e "\033[0;36m==========================================================\033[0m"
echo -e "\033[1;33m SENGO BOT - Worker de Poblamiento Móvil ($COUNTRY)\033[0m"
echo -e "\033[0;36m==========================================================\033[0m"
echo -e "\033[0;37m Key: $KEY\033[0m"
echo -e "\033[0;37m Servidor: $SERVER\033[0m"
echo -e "\033[0;36m==========================================================\033[0m"

TOTAL_SAVED=0

if ! command -v python3 &> /dev/null; then
    echo -e "\033[0;31mError: Se requiere python3. En Termux ejecuta: pkg install python\033[0m"
    exit 1
fi

while true; do
    REQ_TIME=$(date +"%H:%M:%S")
    echo -e "\033[0;37m[$REQ_TIME] Obteniendo lote de mapas desde el servidor...\033[0m"

    BATCH_URL="$SERVER/api/worker/batch?key=$KEY&country=$COUNTRY"
    BATCH_RES=$(curl -sSL "$BATCH_URL")

    STATUS=$(python3 -c "import sys, json; data=json.loads(sys.stdin.read()); print(data.get('status', ''))" <<< "$BATCH_RES" 2>/dev/null)
    ERROR_MSG=$(python3 -c "import sys, json; data=json.loads(sys.stdin.read()); print(data.get('error', ''))" <<< "$BATCH_RES" 2>/dev/null)

    if [ "$STATUS" = "completed" ]; then
        echo -e "\033[0;32m ¡El país $COUNTRY ha sido poblado al 100%! No quedan mapas pendientes.\033[0m"
        break
    fi

    if [ "$STATUS" = "stopped" ]; then
        echo -e "\033[0;31m El poblamiento de $COUNTRY ha sido detenido por el Administrador.\033[0m"
        break
    fi

    if [ -n "$ERROR_MSG" ]; then
        echo -e "\033[0;31m Error del servidor: $ERROR_MSG\033[0m"
        break
    fi

    MAPS_JSON=$(python3 -c "import sys, json; data=json.loads(sys.stdin.read()); print(json.dumps(data.get('maps', [])))" <<< "$BATCH_RES" 2>/dev/null)
    TOKEN=$(python3 -c "import sys, json; data=json.loads(sys.stdin.read()); print(data.get('supporterToken', ''))" <<< "$BATCH_RES" 2>/dev/null)

    MAPS_COUNT=$(python3 -c "import sys, json; data=json.loads(sys.stdin.read()); print(len(data))" <<< "$MAPS_JSON" 2>/dev/null)

    if [ -z "$MAPS_COUNT" ] || [ "$MAPS_COUNT" -eq 0 ]; then
        echo -e "\033[0;32m Sin más mapas pendientes en este momento.\033[0m"
        break
    fi

    TIME_STR=$(date +"%H:%M:%S")
    echo -e "\033[1;37m[$TIME_STR] Lote de $MAPS_COUNT mapas recibido. Raspando...\033[0m"

    SUBMIT_BODY=$(python3 -c "
import sys, json, urllib.request, time

key = '$KEY'
country = '$COUNTRY'
token = '$TOKEN'
maps = json.loads('''$MAPS_JSON''')
scores_to_submit = []

for i, b_id in enumerate(maps):
    url = f'https://osu.ppy.sh/api/v2/beatmaps/{b_id}/scores?mode=osu&type=country'
    req = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {token}',
        'x-api-version': '20220705',
        'User-Agent': 'osu-api-extended v3.4.7'
    })
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            scores = res_data.get('scores', [])
            if len(scores) > 0:
                top1 = scores[0]
                mods_list = [m.get('acronym', str(m)) for m in top1.get('mods', [])]
                mods_str = ''.join(mods_list) if mods_list else 'NM'
                
                sniped_user_id = None
                sniped_username = None
                sniped_ended_at = None
                if len(scores) > 1:
                    top2 = scores[1]
                    sniped_user_id = top2.get('user_id')
                    sniped_username = top2.get('user', {}).get('username')
                    sniped_ended_at = top2.get('ended_at') or top2.get('created_at')

                scores_to_submit.append({
                    'beatmap_id': b_id,
                    'user_id': top1.get('user_id'),
                    'username': top1.get('user', {}).get('username', ''),
                    'score': top1.get('total_score', 0),
                    'pp': top1.get('pp') or 0,
                    'accuracy': top1.get('accuracy') or 0,
                    'mods': mods_str,
                    'ended_at': top1.get('ended_at') or top1.get('created_at', ''),
                    'max_combo': top1.get('max_combo', 0),
                    'perfect': bool(top1.get('perfect', False)),
                    'rank': top1.get('rank', ''),
                    'sniped_user_id': sniped_user_id,
                    'sniped_username': sniped_username,
                    'sniped_ended_at': sniped_ended_at
                })
            else:
                scores_to_submit.append({
                    'beatmap_id': b_id,
                    'user_id': '0',
                    'username': 'SYSTEM_NO_SCORE',
                    'score': 0,
                    'pp': 0,
                    'accuracy': 0,
                    'mods': 'NM',
                    'ended_at': '',
                    'max_combo': 0,
                    'perfect': False,
                    'rank': ''
                })
        print(f' Progress: {i+1}/{len(maps)}', file=sys.stderr)
    except Exception as e:
        print(f' Error en mapa {b_id}: {e}', file=sys.stderr)

    time.sleep(3)

print(json.dumps({'key': key, 'country': country, 'scores': scores_to_submit}))
")

    SUBMIT_URL="$SERVER/api/worker/submit"
    SUBMIT_RES=$(curl -sSL -X POST -H "Content-Type: application/json" -d "$SUBMIT_BODY" "$SUBMIT_URL")
    
    SAVED_COUNT=$(python3 -c "import sys, json; data=json.loads(sys.stdin.read()); print(data.get('saved', 0))" <<< "$SUBMIT_RES" 2>/dev/null)
    TOTAL_SAVED=$((TOTAL_SAVED + SAVED_COUNT))

    echo -e "\033[0;36m Lote enviado a Sengo. Récords guardados: $SAVED_COUNT (Total acumulado: $TOTAL_SAVED)\033[0m"
done
