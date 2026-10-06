#!/usr/bin/env bash
set -euo pipefail
# This experiment runs only in disposable CI workers and is removed before merge.
# Separate the second measurement window from the first (14:58-15:24 UTC).
not_before=$(date -u -d '2026-10-06 15:50:00' +%s)
now=$(date -u +%s)
if (( now < not_before )); then sleep "$((not_before - now))"; fi
report() {
  SAMPLE="$1" node <<'JS'
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync('apps/web/storybook-609.json', 'utf8'));
const events = report.testResults.flatMap(f => [[f.startTime, 1], [f.endTime, -1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
let active=0, maxOverlappingFiles=0;
for(const [,delta] of events) maxOverlappingFiles=Math.max(maxOverlappingFiles,active+=delta);
const file=report.testResults.find(f=>f.name.endsWith('material-authoring-page.stories.tsx'));
const names=['Редактор · блоки урока','Редактирование и автосохранение','Вложенное изображение · форма вложения'];
console.log('[MEASURE-609]', JSON.stringify({sample:process.env.SAMPLE, variant:process.env.VARIANT, startedAt:new Date(Math.min(...report.testResults.map(f=>f.startTime))).toISOString(), files:report.testResults.length, tests:report.numTotalTests, cpus:require('node:os').availableParallelism(), maxOverlappingFiles, fileMs:file.endTime-file.startTime, neighbours:report.testResults.filter(f=>f!==file&&f.startTime<file.endTime&&f.endTime>file.startTime).map(f=>f.name.split('/src/')[1]), testMs:Object.fromEntries(file.assertionResults.filter(t=>names.includes(t.title)).map(t=>[t.title,t.duration])), testStatuses:Object.fromEntries(file.assertionResults.filter(t=>names.includes(t.title)).map(t=>[t.title,t.status]))}));
JS
}
# Reverse the order used in the first window.
pnpm test:storybook --no-file-parallelism --reporter=default --reporter=json --outputFile=storybook-609.json
report serial
pnpm test:storybook --reporter=default --reporter=json --outputFile=storybook-609.json
report parallel
# Use real editor transactions. Twelve rounds of the original 47-character input
# deliberately increase the baseline; final field values and assertions stay identical.
python3 <<'PY'
from pathlib import Path
import re
p=Path('apps/web/src/_pages/material-authoring/ui/material-authoring-page.stories.tsx')
s=p.read_text(); start=s.index('export const LessonBlocksEditing:'); end=s.index('\nexport const ',start+1)
part=s[start:end]
for label,value in [('Название врезки','Не забудьте'),('Название ресурса','Спецификация'),('Адрес ресурса','https://example.com/spec')]:
 pattern=r'await fillByPaste\(\s*inputField\(canvasElement, "'+re.escape(label)+r'"\),\s*"'+re.escape(value)+r'",?\s*\);'
 part,n=re.subn(pattern,'await diagnosticTyping(inputField(canvasElement, "'+label+'"), "'+value+'");',part)
 assert n==1,(label,n)
s=s[:start]+part+s[end:]
s+='\nasync function diagnosticTyping(field: HTMLInputElement | HTMLTextAreaElement, value: string) {\n  for (let round = 0; round < 12; round++) {\n    await userEvent.clear(field);\n    await userEvent.type(field, value, { delay: null });\n  }\n}\n'
p.write_text(s)
PY
cpu=$(awk '/Cpus_allowed_list/ {print $2}' /proc/self/status | cut -d, -f1 | cut -d- -f1)
hogs=()
cleanup() { for pid in "${hogs[@]}"; do kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done; hogs=(); }
trap cleanup EXIT
# Counterbalance loaded/unloaded order across variants.
if [[ "$VARIANT" == before ]]; then modes=(loaded idle); else modes=(idle loaded); fi
for mode in "${modes[@]}"; do
  if [[ "$mode" == loaded ]]; then
    for i in 1 2; do taskset -c "$cpu" node -e 'let x=1; while(true) x=(Math.imul(x,1664525)+1013904223)|0' & hogs+=("$!"); done
  fi
  echo "[CONTROL-609] variant=$VARIANT mode=$mode cpu=$cpu hogs=${#hogs[@]} rounds=12"
  # Both cases give Node and its Chromium children the same single CPU.
  # Timeout is diagnostic only: successful task durations remain uncensored at 15000ms.
  taskset -c "$cpu" pnpm test:storybook src/_pages/material-authoring/ui/material-authoring-page.stories.tsx --testTimeout=120000 --reporter=default --reporter=json --outputFile=storybook-609.json
  report "typing12-$mode"
  cleanup
done
