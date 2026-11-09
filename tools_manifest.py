#!/usr/bin/env python3
# gas/manifest.json を作る（更新ボタンが読む一覧。コミット前に実行）
import json, os, sys, datetime
d = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gas')
files = sorted(f for f in os.listdir(d) if f.endswith(('.gs', '.html')) or f == 'appsscript.json')
note = sys.argv[1] if len(sys.argv) > 1 else ''
ver = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y%m%d-%H%M')
json.dump({'version': ver, 'note': note, 'files': files}, open(os.path.join(d, 'manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(ver, len(files), 'files')
