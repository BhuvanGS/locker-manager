#!/bin/zsh
# Assemble the promo: frames/all (30 fps) + the song from 0:55, captions and the title card. Output: promo.mp4
set -e
cd "$(dirname "$0")"
SONG="$HOME/Downloads/Grieg - In the Hall of the Mountain King.mp4"
BLACK="/System/Library/Fonts/Supplemental/Arial Black.ttf"
AVENIR="/System/Library/Fonts/Avenir Next.ttc"
DUR=104

# A caption: text, start, end (fades in and out over 0.35 s), at the lower third.
cap() {
  local text="$1" a="$2" b="$3"
  echo "drawtext=fontfile='$BLACK':text='$text':fontsize=58:fontcolor=white:borderw=4:bordercolor=black@0.55:shadowx=0:shadowy=6:shadowcolor=black@0.35:x=(w-text_w)/2:y=h*0.78:alpha='if(lt(t,$a),0,if(lt(t,$a+0.35),(t-$a)/0.35,if(lt(t,$b-0.35),1,if(lt(t,$b),($b-t)/0.35,0))))'"
}

# A toast like the game's own: a dark rounded-looking box at the top right, a small coloured label above the text.
toast() {
  local label="$1" text="$2" a="$3" b="$4" colour="${5:-0xfde68a}"
  local alpha="if(lt(t,$a),0,if(lt(t,$a+0.25),(t-$a)/0.25,if(lt(t,$b-0.3),1,if(lt(t,$b),($b-t)/0.3,0))))"
  echo "drawbox=x=iw-760:y=60:w=700:h=118:color=0x0f172a@0.86:t=fill:enable='between(t,$a,$b)',\
drawbox=x=iw-760:y=60:w=8:h=118:color=$colour@0.95:t=fill:enable='between(t,$a,$b)',\
drawtext=fontfile='$AVENIR':text='$label':fontsize=26:fontcolor=$colour:x=w-728:y=78:alpha='$alpha',\
drawtext=fontfile='$AVENIR':text='$text':fontsize=38:fontcolor=white:x=w-728:y=114:alpha='$alpha'"
}

FILTERS=$(
  printf '%s,' \
    "$(cap 'EVERY BAG. EVERY KEY.' 1.2 6.4)" \
    "$(cap 'REMEMBER WHERE IT WENT.' 26.3 31.4)" \
    "$(cap 'THE QUEUE NEVER STOPS.' 32.4 35.8)" \
    "$(toast 'UPGRADE BOUGHT' 'Deposit register board' 37.3 39.6)" \
    "$(toast 'UPGRADE BOUGHT' 'Floor 1 · upper storage hall' 42.5 45.6)" \
    "$(toast 'UPGRADE BOUGHT' 'Conveyor and robot arm' 46.9 50.0)" \
    "$(cap 'THEN AUTOMATE EVERYTHING.' 47.2 51.2)" \
    "$(toast 'UPGRADE BOUGHT' 'Warehouse' 51.6 54.6)" \
    "$(toast 'UPGRADE BOUGHT' 'Underground vault' 55.5 57.4)" \
    "$(toast 'SOMEONE IS HERE' 'Unmarked crates · no questions asked' 57.6 59.5 0xf87171)" \
    "$(cap 'GROW A WHOLE TOWN.' 63.8 67.4)" \
    "$(toast 'DEAL SIGNED' 'A VIP contract for the warehouse' 69.0 71.1 0x86efac)" \
    "$(toast 'UPGRADE BOUGHT' 'Great harbour' 71.3 74.2)" \
    "$(cap 'UNTIL SOMETHING BIG ARRIVES...' 81.7 85.4)"
)
# The title card over the last shot: darken it, then the name and the tagline, then fade to black.
TITLE="drawbox=x=0:y=0:w=iw:h=ih:color=black@0.45:t=fill:enable='gte(t,98.2)',\
drawtext=fontfile='$BLACK':text='LOCKER MANAGER':fontsize=150:fontcolor=white:borderw=6:bordercolor=black@0.5:x=(w-text_w)/2:y=h*0.36:alpha='if(lt(t,98.3),0,min(1,(t-98.3)/0.6))',\
drawtext=fontfile='$AVENIR':text='Remember the key. Build the empire.':fontsize=50:fontcolor=0xfde68a:x=(w-text_w)/2:y=h*0.56:alpha='if(lt(t,99.3),0,min(1,(t-99.3)/0.7))',\
fade=t=in:st=0:d=0.8,fade=t=out:st=$((DUR - 1.2)):d=1.2"

ffmpeg -v error -y -framerate 30 -i frames/all/%05d.jpg -ss 55 -t $DUR -i "$SONG" \
  -filter_complex "[0:v]${FILTERS}${TITLE},format=yuv420p[v];[1:a]afade=t=out:st=$((DUR - 2)):d=2[a]" \
  -map "[v]" -map "[a]" -t $DUR -c:v libx264 -preset slow -crf 18 -c:a aac -b:a 192k -movflags +faststart 'Locker Manager promo.mp4'
ffmpeg -v error -y -i 'Locker Manager promo.mp4' -c:v libx264 -preset slow -crf 24 -c:a copy -movflags +faststart 'Locker Manager promo (small).mp4'
echo built
