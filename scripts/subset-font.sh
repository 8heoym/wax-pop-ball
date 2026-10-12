#!/usr/bin/env bash
# 한글 둥근 폰트 Jua를 앱에서 화면에 그리는 글자만 남겨 서브셋 (Eng re-review R11).
# 전체 파일 약 2.1MB → 수 KB. 화면 글자를 바꾸면 다시 실행할 것.
#
# 준비: pip install fonttools brotli   (pyftsubset 명령)
# 사용: scripts/subset-font.sh path/to/Jua-Regular.ttf
#       원본: https://github.com/google/fonts/tree/main/ofl/jua (SIL OFL 1.1)
set -euo pipefail
SOURCE=${1:?Jua-Regular.ttf 경로를 넘겨주세요}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PYFTSUBSET=${PYFTSUBSET:-pyftsubset}

# index.html 본문에서 화면에 그려지는 텍스트 노드의 한글 (주석, aria-label 같은 속성, <title> 제외)
# + src/palette.ts의 문자열 한글 (튜브 이름, 묶음 이름. 주석 제외)
# + 인쇄 가능한 ASCII + ©. macOS grep은 한글 범위를 바이트로 다뤄 놓치므로 Python으로 추출
PYTHON=${PYTHON:-python3}
# Windows에서 한글이 cp949로 깨져 엉뚱한 글자가 서브셋되지 않도록
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
HANGUL=$("$PYTHON" - "$ROOT/index.html" "$ROOT/src/palette.ts" <<'PYEOF'
import re, sys
from html.parser import HTMLParser

class Visible(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip = 0
        self.chars = set()
    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "title", "head"):
            self.skip += 1
    def handle_endtag(self, tag):
        if tag in ("script", "style", "title", "head"):
            self.skip -= 1
    def handle_data(self, data):
        if not self.skip:
            self.chars.update(re.findall("[가-힣]", data))

parser = Visible()
parser.feed(open(sys.argv[1], encoding="utf-8").read())
for line in open(sys.argv[2], encoding="utf-8"):
    if line.lstrip().startswith("//"):
        continue
    for literal in re.findall(r"'([^']*)'", line):
        parser.chars.update(re.findall("[가-힣]", literal))
print("".join(sorted(parser.chars)))
PYEOF
)
TEXT="${HANGUL}©"
"$PYFTSUBSET" "$SOURCE" \
  --text="$TEXT" \
  --unicodes="U+0020-007E" \
  --flavor=woff2 \
  --layout-features='*' \
  --output-file="$ROOT/src/assets/jua-subset.woff2"
echo "글자: $TEXT"
ls -l "$ROOT/src/assets/jua-subset.woff2"
