import pathlib
H=pathlib.Path(__file__).parent; W=H.parent.parent/'apk'/'www'/'fonts'
t=(H/'tpl.html').read_text(encoding='utf8')
t=t.replace('/*CSS*/',(W/'sw-motion.css').read_text(encoding='utf8')).replace('/*JS*/',(W/'sw-motion.js').read_text(encoding='utf8'))
(H/'preview.html').write_text(t,encoding='utf8'); print(len(t))
