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

FILTERS=$(
  printf '%s,' \
    "$(cap 'EVERY BAG. EVERY KEY.' 1.2 6.4)" \
    "$(cap 'THEN AUTOMATE EVERYTHING.' 26.3 31.6)" \
    "$(cap 'GROW A WHOLE TOWN.' 46.9 51.2)" \
    "$(cap 'UNTIL SOMETHING BIG ARRIVES...' 81.7 85.4)"
)
# The title card over the last shot: darken it, then the name and the tagline, then fade to black.
TITLE="drawbox=x=0:y=0:w=iw:h=ih:color=black@0.45:t=fill:enable='gte(t,98.2)',\
drawtext=fontfile='$BLACK':text='LOCKER MANAGER':fontsize=150:fontcolor=white:borderw=6:bordercolor=black@0.5:x=(w-text_w)/2:y=h*0.36:alpha='if(lt(t,98.3),0,min(1,(t-98.3)/0.6))',\
drawtext=fontfile='$AVENIR':text='Remember the key. Build the empire.':fontsize=50:fontcolor=0xfde68a:x=(w-text_w)/2:y=h*0.56:alpha='if(lt(t,99.3),0,min(1,(t-99.3)/0.7))',\
fade=t=in:st=0:d=0.8,fade=t=out:st=$((DUR - 1.2)):d=1.2"

ffmpeg -v error -y -framerate 30 -i frames/all/%05d.jpg -ss 55 -t $DUR -i "$SONG" \
  -filter_complex "[0:v]${FILTERS}${TITLE},format=yuv420p[v];[1:a]afade=t=out:st=$((DUR - 2)):d=2[a]" \
  -map "[v]" -map "[a]" -t $DUR -c:v libx264 -preset slow -crf 18 -c:a aac -b:a 192k -movflags +faststart promo.mp4
echo built promo.mp4
