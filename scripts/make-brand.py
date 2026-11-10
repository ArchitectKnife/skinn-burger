# Генерация фирменных SVG BURGER SKIN: логотип, заглушка предмета, базовая обложка кейса и обложки стартовых кейсов.
import os
ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'img')
os.makedirs(os.path.join(ROOT, 'brand'), exist_ok=True)
os.makedirs(os.path.join(ROOT, 'cases'), exist_ok=True)

LOGO = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFCF5C"/><stop offset="1" stop-color="#F4A259"/></linearGradient></defs>
<path d="M8 28c0-12 11-20 24-20s24 8 24 20z" fill="url(#b)"/><circle cx="22" cy="18" r="1.6" fill="#fff3d6"/><circle cx="32" cy="14" r="1.6" fill="#fff3d6"/><circle cx="42" cy="18" r="1.6" fill="#fff3d6"/>
<path d="M6 31h52l-4 5-5-3-5 3-5-3-5 3-5-3-5 3-5-3-5 3z" fill="#7AC74F"/><rect x="7" y="36" width="50" height="7" rx="3" fill="#E63946"/>
<rect x="8" y="44" width="48" height="5" rx="2.5" fill="#FFB627"/><path d="M9 50h46c0 4-4 7-9 7H18c-5 0-9-3-9-7z" fill="url(#b)"/></svg>'''
ITEM = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 192"><defs><radialGradient id="g" cx="50%" cy="55%" r="60%"><stop offset="0" stop-color="#2a2f3d"/><stop offset="1" stop-color="#161922"/></radialGradient></defs>
<rect width="256" height="192" rx="16" fill="url(#g)"/><g opacity=".55" transform="translate(96 64) scale(1)"><path d="M8 28c0-12 11-20 24-20s24 8 24 20z" fill="#FFB627"/><rect x="7" y="32" width="50" height="7" rx="3" fill="#E63946"/><path d="M9 42h46c0 4-4 7-9 7H18c-5 0-9-3-9-7z" fill="#F4A259"/></g></svg>'''
open(os.path.join(ROOT, 'brand', 'logo.svg'), 'w').write(LOGO)
open(os.path.join(ROOT, 'brand', 'item.svg'), 'w').write(ITEM)

def case_svg(c1, c2, accent, label):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><defs>
<linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient>
<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient>
<radialGradient id="glow" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="{accent}" stop-opacity=".55"/><stop offset="1" stop-color="{accent}" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="160" cy="120" rx="150" ry="110" fill="url(#glow)"/>
<path d="M52 92 160 56l108 36v86l-108 40-108-40z" fill="url(#t)"/>
<path d="M52 92 160 128l108-36" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="3"/>
<path d="M160 128v90" stroke="#000" stroke-opacity=".25" stroke-width="3"/>
<path d="M52 92 160 128v90l-108-40z" fill="url(#s)"/>
<path d="M100 74l108 36" stroke="{accent}" stroke-width="10" stroke-linecap="round" opacity=".9"/>
<rect x="128" y="138" width="64" height="30" rx="7" fill="#0d0f14" opacity=".75"/>
<text x="160" y="159" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="16" font-weight="900" fill="{accent}">{label}</text></svg>'''

CASES = {
  'burger-starter': ('#F4A259', '#c46b2a', '#FFE08A', 'BS'),
  'electro-mix': ('#3a7bd5', '#1b2a6b', '#7DF9FF', 'KW'),
  'burger-royale': ('#8a2be2', '#3b0f6b', '#FFB627', 'VIP'),
  'kukri-collection': ('#e4ae39', '#7a5410', '#fff1b8', '★'),
  'army-order': ('#4b69ff', '#1d2a7a', '#b8c6ff', 'MS'),
  'restricted-sauce': ('#8847ff', '#3a1a7a', '#d9c4ff', 'RS'),
  'classified-recipe': ('#d32ce6', '#5e0f6b', '#ffc4f7', 'CL'),
  'secret-ingredient': ('#eb4b4b', '#6b1010', '#ffd0d0', 'CV'),
  'pistol-burger': ('#7AC74F', '#2f6b1b', '#e5ffd0', 'P'),
  'smg-combo': ('#2ec4b6', '#0f5b55', '#d0fff9', 'SMG'),
  'rifle-grill': ('#E63946', '#6b1018', '#FFB627', 'AR'),
  'heavy-roast': ('#6d6875', '#2b2830', '#FFB627', 'HV'),
  'night-shift': ('#22223b', '#0b0b16', '#9a8cff', 'NS'),
  'forest-bbq': ('#4f772d', '#1f3310', '#ecf39e', 'FB'),
  'bloody-steak': ('#9d0208', '#370003', '#ffba08', 'BL'),
  'steel-and-fire': ('#457b9d', '#1d3557', '#ffb627', 'SF'),
}
for slug, (a, b, c, l) in CASES.items():
    open(os.path.join(ROOT, 'cases', slug + '.svg'), 'w').write(case_svg(a, b, c, l))
open(os.path.join(ROOT, 'brand', 'case.svg'), 'w').write(case_svg('#FFB627', '#c46b2a', '#E63946', 'BS'))
print('ok', len(CASES))
